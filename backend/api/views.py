import functools
import io
import json
import random
import secrets
import string
from datetime import timedelta

from django.conf import settings
from django.contrib.auth.hashers import make_password, check_password
from django.http import JsonResponse, HttpResponse
from django.utils import timezone
from django.utils.dateparse import parse_date
from django.views.decorators.csrf import csrf_exempt

from rest_framework.decorators import api_view
from rest_framework.response import Response

from . import ml
from . import trend
from .models import Reading, TrainingSample, CropGuideline, Field, FertilizerType, CostEstimate, Farm, StaffAccount
from .serializers import (
    ReadingSerializer, CropGuidelineSerializer,
    FieldSerializer, FertilizerTypeSerializer, CostEstimateSerializer, FarmSerializer,
)

# Fields a client may push. The RS485 3-in-1 sensor reports only n, p, k;
# ph / moisture / temperature are optional (other sensors or manual entry).
INGEST_FIELDS = ('n', 'p', 'k', 'ph', 'moisture', 'temperature')

# Where the trained crop model is cached on disk (survives restarts).
MODEL_PATH = settings.BASE_DIR / 'ml_model.json'

# Starter labelled data — soil ranges (min,max) per crop used to synthesise a
# seed training set so the model can be trained immediately. Keys match the
# frontend crop keys. Admins can add their own real samples on top.
SEED_RANGES = {
    'tomato':   {'n': (100, 200), 'p': (25, 50), 'k': (150, 300), 'ph': (5.5, 7.5), 'moisture': (50, 75)},
    'brinjal':  {'n': (100, 180), 'p': (25, 45), 'k': (150, 280), 'ph': (5.5, 5.8), 'moisture': (55, 75)},
    'okra':     {'n': (80, 160),  'p': (20, 40), 'k': (120, 220), 'ph': (6.0, 7.0), 'moisture': (50, 70)},
    'capsicum': {'n': (90, 180),  'p': (25, 45), 'k': (130, 250), 'ph': (5.5, 6.8), 'moisture': (55, 75)},
    'cabbage':  {'n': (120, 220), 'p': (30, 55), 'k': (150, 280), 'ph': (6.0, 6.5), 'moisture': (55, 75)},
    'carrot':   {'n': (80, 150),  'p': (20, 45), 'k': (150, 280), 'ph': (5.5, 6.5), 'moisture': (50, 70)},
    'potato':   {'n': (110, 200), 'p': (30, 55), 'k': (180, 320), 'ph': (5.5, 6.6), 'moisture': (55, 75)},
    'radish':   {'n': (80, 150),  'p': (20, 45), 'k': (120, 240), 'ph': (6.0, 7.5), 'moisture': (50, 70)},
    'beans':    {'n': (60, 130),  'p': (20, 45), 'k': (110, 220), 'ph': (5.5, 6.5), 'moisture': (45, 70)},
}


def require_admin(view):
    """Reject requests without the correct X-Admin-Password header."""
    @functools.wraps(view)
    def wrapper(request, *args, **kwargs):
        supplied = request.headers.get('X-Admin-Password', '')
        if supplied != settings.ADMIN_PASSWORD:
            return JsonResponse({'error': 'unauthorized'}, status=401)
        return view(request, *args, **kwargs)
    return wrapper


# ----------------------------------------------------------------------------
# Land accounts — a land IS the login unit (no separate farmer usernames).
# A farmer registers a land, gets a public Land ID, and signs in with
# (land_id, password). Every land-scoped request carries the token the login
# returns, so one land only ever sees its own readings and calculations.
# ----------------------------------------------------------------------------

# Unambiguous alphabet for the public Land ID: no 0/O/1/I so it's easy to read
# off a screen and type back in. 6 chars ≈ 1.9 billion combinations.
_LAND_ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'


def _generate_land_id():
    """Return a short, unique, human-friendly Land ID (e.g. 'K7F9Q2')."""
    for _ in range(20):
        candidate = ''.join(secrets.choice(_LAND_ID_ALPHABET) for _ in range(6))
        if not Field.objects.filter(land_id=candidate).exists():
            return candidate
    # Astronomically unlikely; fall back to a longer code rather than loop forever.
    return ''.join(secrets.choice(_LAND_ID_ALPHABET) for _ in range(10))


def require_land(view):
    """Resolve the land session token and attach the Field as request.land.

    The frontend sends the token from login/registration in an
    `Authorization: Bearer <token>` (or `X-Land-Token`) header. A missing or
    unknown token is rejected with 401 so no land data leaks without a session.
    """
    @functools.wraps(view)
    def wrapper(request, *args, **kwargs):
        token = request.headers.get('X-Land-Token', '')
        if not token:
            auth = request.headers.get('Authorization', '')
            if auth.startswith('Bearer '):
                token = auth[len('Bearer '):].strip()
        land = Field.objects.filter(auth_token=token).first() if token else None
        if land is None:
            return JsonResponse({'error': 'login required'}, status=401)
        request.land = land
        return view(request, *args, **kwargs)
    return wrapper


@csrf_exempt
def land_register(request):
    """Register a new land, mint its Land ID, and return a session token.

    Body: {name, password, details?, location?, size_acres?, crop_key?, mode?}.
    Creates a Field the farmer owns and logs them straight in. The plaintext
    password is hashed (never stored) and the response is the only time the
    Land ID is shown, so the frontend must surface it to the farmer to note.
    """
    if request.method != 'POST':
        return JsonResponse({'error': 'POST required'}, status=405)
    try:
        body = json.loads(request.body.decode('utf-8') or '{}')
    except (ValueError, UnicodeDecodeError):
        return JsonResponse({'error': 'invalid JSON body'}, status=400)

    name = str(body.get('name', '')).strip()
    password = str(body.get('password', ''))
    if not name:
        return JsonResponse({'error': 'name is required'}, status=400)
    if len(password) < 4:
        return JsonResponse({'error': 'password must be at least 4 characters'}, status=400)

    try:
        size_acres = float(body.get('size_acres', 1) or 1)
        if size_acres <= 0:
            size_acres = 1.0
    except (TypeError, ValueError):
        size_acres = 1.0

    mode = str(body.get('mode', 'existing')).strip().lower()
    if mode not in ('existing', 'empty'):
        mode = 'existing'

    land = Field.objects.create(
        name=name,
        details=str(body.get('details', '')).strip()[:255],
        size_acres=size_acres,
        crop_key=str(body.get('crop_key', '')).strip()[:50],
        mode=mode,
        owner_name=str(body.get('owner_name', '')).strip()[:100],
        contact_number=str(body.get('contact_number', '')).strip()[:20],
        region=str(body.get('region', '')).strip()[:50],
        land_id=_generate_land_id(),
        password_hash=make_password(password),
        auth_token=secrets.token_hex(32),
    )
    return JsonResponse({'ok': True, 'land_id': land.land_id, 'token': land.auth_token,
                         'field': FieldSerializer(land).data}, status=201)


@csrf_exempt
def land_login(request):
    """Sign in to a land with (land_id, password); returns a fresh token."""
    if request.method != 'POST':
        return JsonResponse({'error': 'POST required'}, status=405)
    try:
        body = json.loads(request.body.decode('utf-8') or '{}')
    except (ValueError, UnicodeDecodeError):
        return JsonResponse({'error': 'invalid JSON body'}, status=400)

    land_id = str(body.get('land_id', '')).strip().upper()
    password = str(body.get('password', ''))
    land = Field.objects.filter(land_id=land_id).first() if land_id else None
    # Constant-ish response: same error whether the id or the password is wrong.
    if land is None or not land.password_hash or not check_password(password, land.password_hash):
        return JsonResponse({'error': 'wrong Land ID or password'}, status=401)

    land.auth_token = secrets.token_hex(32)  # rotate on each login
    land.save(update_fields=['auth_token'])
    return JsonResponse({'ok': True, 'land_id': land.land_id, 'token': land.auth_token,
                         'field': FieldSerializer(land).data})


@require_land
def land_me(request):
    """Return the currently logged-in land (validates a stored token)."""
    return JsonResponse({'ok': True, 'land_id': request.land.land_id,
                         'field': FieldSerializer(request.land).data})


@csrf_exempt
@require_land
def land_logout(request):
    """Invalidate the current session token."""
    request.land.auth_token = ''
    request.land.save(update_fields=['auth_token'])
    return JsonResponse({'ok': True})


# ----------------------------------------------------------------------------
# Staff accounts + role-based access control (government / agronomist / admin).
# Farmers log in per-land; staff oversee data across lands. The legacy
# X-Admin-Password acts as a bootstrap super-admin so the first admin account
# can be created before any staff exist.
# ----------------------------------------------------------------------------

ROLE_RANK = {'government': 1, 'agronomist': 2, 'admin': 3}


def _staff_from_request(request):
    """Return the StaffAccount for the X-Staff-Token header, or None."""
    token = request.headers.get('X-Staff-Token', '')
    if not token:
        auth = request.headers.get('Authorization', '')
        if auth.startswith('Bearer '):
            token = auth[len('Bearer '):].strip()
    return StaffAccount.objects.filter(auth_token=token).first() if token else None


def require_role(*allowed):
    """Gate a view to staff whose role is in `allowed`. The legacy admin
    password header is always accepted (it's the super-admin bootstrap)."""
    def decorator(view):
        @functools.wraps(view)
        def wrapper(request, *args, **kwargs):
            if request.headers.get('X-Admin-Password', '') == settings.ADMIN_PASSWORD:
                request.staff = None  # legacy super-admin
                request.role = 'admin'
                return view(request, *args, **kwargs)
            staff = _staff_from_request(request)
            if staff is None:
                return JsonResponse({'error': 'login required'}, status=401)
            if allowed and staff.role not in allowed:
                return JsonResponse({'error': 'forbidden for this role'}, status=403)
            request.staff = staff
            request.role = staff.role
            return view(request, *args, **kwargs)
        return wrapper
    return decorator


def _staff_dict(s):
    return {'id': s.id, 'username': s.username, 'role': s.role,
            'full_name': s.full_name, 'created_at': s.created_at.isoformat()}


@csrf_exempt
def staff_login(request):
    """Sign in a staff account (username + password) -> token + role."""
    if request.method != 'POST':
        return JsonResponse({'error': 'POST required'}, status=405)
    try:
        body = json.loads(request.body.decode('utf-8') or '{}')
    except (ValueError, UnicodeDecodeError):
        return JsonResponse({'error': 'invalid JSON body'}, status=400)
    username = str(body.get('username', '')).strip().lower()
    password = str(body.get('password', ''))
    staff = StaffAccount.objects.filter(username=username).first() if username else None
    if staff is None or not check_password(password, staff.password_hash):
        return JsonResponse({'error': 'wrong username or password'}, status=401)
    staff.auth_token = secrets.token_hex(32)
    staff.save(update_fields=['auth_token'])
    return JsonResponse({'ok': True, 'token': staff.auth_token, 'staff': _staff_dict(staff)})


@require_role('admin')
def staff_me(request):
    """Validate a stored staff token; report who/what role."""
    if request.staff is None:  # legacy admin password
        return JsonResponse({'ok': True, 'staff': {'username': 'admin', 'role': 'admin', 'full_name': 'Super Admin'}})
    return JsonResponse({'ok': True, 'staff': _staff_dict(request.staff)})


@csrf_exempt
@require_role('admin')
def staff_create(request):
    """Admin-only: create a staff account (government / agronomist / admin)."""
    if request.method != 'POST':
        return JsonResponse({'error': 'POST required'}, status=405)
    try:
        body = json.loads(request.body.decode('utf-8') or '{}')
    except (ValueError, UnicodeDecodeError):
        return JsonResponse({'error': 'invalid JSON body'}, status=400)
    username = str(body.get('username', '')).strip().lower()[:50]
    password = str(body.get('password', ''))
    role = str(body.get('role', 'government')).strip().lower()
    if not username or len(password) < 4:
        return JsonResponse({'error': 'username and a 4+ char password are required'}, status=400)
    if role not in ROLE_RANK:
        return JsonResponse({'error': 'role must be government, agronomist or admin'}, status=400)
    if StaffAccount.objects.filter(username=username).exists():
        return JsonResponse({'error': f'"{username}" already exists'}, status=409)
    staff = StaffAccount.objects.create(
        username=username, password_hash=make_password(password),
        role=role, full_name=str(body.get('full_name', '')).strip()[:100])
    return JsonResponse({'ok': True, 'staff': _staff_dict(staff)}, status=201)


@require_role('admin')
def staff_list(request):
    """Admin-only: list all staff accounts."""
    return JsonResponse({'staff': [_staff_dict(s) for s in StaffAccount.objects.all()]})


@csrf_exempt
@require_land
def land_update(request):
    """PUT: update the logged-in land's own details (name/size/crop/device)."""
    if request.method != 'PUT':
        return JsonResponse({'error': 'PUT required'}, status=405)
    try:
        body = json.loads(request.body.decode('utf-8') or '{}')
    except (ValueError, UnicodeDecodeError):
        return JsonResponse({'error': 'invalid JSON body'}, status=400)

    land = request.land
    if 'name' in body:
        name = str(body['name']).strip()
        if name:
            land.name = name[:100]
    if 'details' in body:
        land.details = str(body['details']).strip()[:255]
    if 'crop_key' in body:
        land.crop_key = str(body['crop_key']).strip()[:50]
    if 'mode' in body:
        m = str(body['mode']).strip().lower()
        if m in ('existing', 'empty'):
            land.mode = m
    if 'device_id' in body:
        land.device_id = str(body['device_id']).strip()[:64]
    if 'owner_name' in body:
        land.owner_name = str(body['owner_name']).strip()[:100]
    if 'contact_number' in body:
        land.contact_number = str(body['contact_number']).strip()[:20]
    if 'region' in body:
        land.region = str(body['region']).strip()[:50]
    if 'size_acres' in body:
        try:
            size = float(body['size_acres'])
            if size > 0:
                land.size_acres = size
        except (TypeError, ValueError):
            pass
    land.save()
    return JsonResponse({'ok': True, 'field': FieldSerializer(land).data})


@require_land
def land_latest(request):
    """Most recent reading for the logged-in land only."""
    latest = Reading.objects.filter(field=request.land).first()
    return JsonResponse(_serialize(latest))


@require_land
def land_history(request):
    """Last 50 readings for the logged-in land (most-recent last)."""
    rows = list(Reading.objects.filter(field=request.land)[:50])
    rows.reverse()
    return JsonResponse({'readings': [_serialize(r) for r in rows]})


@require_land
def land_anomalies(request):
    """Flag suspicious readings for this land — a light guard against a stuck,
    glitchy, or tampered sensor. Looks at the last ~20 readings for three
    signals: physically impossible values, a sensor stuck on identical N/P/K,
    and sudden implausible spikes between consecutive readings. Returns the
    flags so the dashboard can warn the farmer instead of trusting bad data.
    """
    rows = list(Reading.objects.filter(field=request.land)[:20])  # newest first
    rows.reverse()  # oldest -> newest for delta checks
    flags = []

    for r in rows:
        for key, (lo, hi) in (('ph', (3.0, 9.5)), ('moisture', (0, 100))):
            v = getattr(r, key)
            if v is not None and not (lo <= v <= hi):
                flags.append({'type': 'out_of_range', 'nutrient': key, 'value': v,
                              'time': r.created_at.isoformat()})

    # Stuck sensor: the 3 most recent readings have identical N, P and K.
    if len(rows) >= 3:
        last3 = rows[-3:]
        if len({(x.n, x.p, x.k) for x in last3}) == 1 and last3[0].n is not None:
            flags.append({'type': 'stuck', 'nutrient': 'npk',
                          'value': f'N={last3[-1].n} P={last3[-1].p} K={last3[-1].k}',
                          'time': last3[-1].created_at.isoformat()})

    # Sudden spike: a nutrient more than triples (and jumps >150) between two
    # consecutive readings — a classic bad-frame / tamper signature.
    for prev, cur in zip(rows, rows[1:]):
        for key in ('n', 'p', 'k'):
            a, b = getattr(prev, key), getattr(cur, key)
            if a and b and a > 0 and (b > a * 3 and b - a > 150):
                flags.append({'type': 'spike', 'nutrient': key, 'value': b,
                              'from': a, 'time': cur.created_at.isoformat()})

    return JsonResponse({'ok': True, 'anomalies': flags, 'checked': len(rows)})


@csrf_exempt
@require_land
def land_reading(request):
    """POST a reading (e.g. manual entry) and attach it to the logged-in land."""
    if request.method != 'POST':
        return JsonResponse({'error': 'POST required'}, status=405)
    try:
        body = json.loads(request.body.decode('utf-8') or '{}')
    except (ValueError, UnicodeDecodeError):
        return JsonResponse({'error': 'invalid JSON body'}, status=400)

    values = {}
    for key in INGEST_FIELDS:
        if key in body and body[key] is not None:
            try:
                values[key] = round(float(body[key]), 1)
            except (TypeError, ValueError):
                pass
    if not values:
        return JsonResponse({'error': 'no recognised fields in body'}, status=400)
    for key in ('n', 'p', 'k'):
        if key in values and not (0 <= values[key] <= 3000):
            return JsonResponse(
                {'error': f'implausible {key}={values[key]} (0-3000 mg/kg expected)'}, status=422)

    reading = Reading.objects.create(field=request.land, **values)
    return JsonResponse({'ok': True, 'reading': _serialize(reading)})


@csrf_exempt
@require_land
def land_plan_pdf(request):
    """Render this land's fertilizer plan to a downloadable PDF.

    The frontend already computes the per-acre DOA programme (it holds the crop
    tables), so it POSTs the finished rows + reading here and the server just
    lays them out as a PDF — land identity (name / owner / Land ID / district)
    is taken from the session, not the body, so the slip is authoritative.
    """
    if request.method != 'POST':
        return JsonResponse({'error': 'POST required'}, status=405)
    try:
        body = json.loads(request.body.decode('utf-8') or '{}')
    except (ValueError, UnicodeDecodeError):
        return JsonResponse({'error': 'invalid JSON body'}, status=400)

    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.lib import colors
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
    from reportlab.lib.styles import getSampleStyleSheet

    land = request.land
    crop_name = str(body.get('crop_name', ''))[:60]
    size_acres = body.get('size_acres') or land.size_acres
    reading = body.get('reading') or {}
    rows = body.get('rows') or []      # [{stage, urea, tsp, mop}]
    totals = body.get('totals') or {}

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, title=f'Fertilizer Plan — {land.name}',
                            topMargin=18 * mm, bottomMargin=18 * mm)
    styles = getSampleStyleSheet()
    story = [Paragraph('Fertilizer Application Plan', styles['Title'])]
    story.append(Paragraph(timezone.now().strftime('Generated %Y-%m-%d %H:%M'), styles['Normal']))
    story.append(Spacer(1, 6 * mm))

    meta = [
        ['Land', land.name or '-', 'Owner', land.owner_name or '-'],
        ['Land ID', land.land_id or '-', 'District', land.region or '-'],
        ['Crop', crop_name or '-', 'Size', f'{size_acres} acres'],
    ]
    mt = Table(meta, hAlign='LEFT', colWidths=[24 * mm, 55 * mm, 24 * mm, 55 * mm])
    mt.setStyle(TableStyle([('FONTSIZE', (0, 0), (-1, -1), 9),
                            ('FONTNAME', (0, 0), (0, -1), 'Helvetica-Bold'),
                            ('FONTNAME', (2, 0), (2, -1), 'Helvetica-Bold'),
                            ('BOTTOMPADDING', (0, 0), (-1, -1), 4)]))
    story.append(mt)
    story.append(Spacer(1, 6 * mm))

    if reading:
        story.append(Paragraph('Current Soil Reading', styles['Heading3']))
        rd = [['N', 'P', 'K', 'pH', 'Moisture'],
              [reading.get('n', '-'), reading.get('p', '-'), reading.get('k', '-'),
               reading.get('ph', '-'), reading.get('moisture', '-')]]
        rt = Table(rd, hAlign='LEFT')
        rt.setStyle(TableStyle([('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#059669')),
                                ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
                                ('GRID', (0, 0), (-1, -1), 0.5, colors.grey),
                                ('FONTSIZE', (0, 0), (-1, -1), 9)]))
        story.append(rt)
        story.append(Spacer(1, 6 * mm))

    if rows:
        story.append(Paragraph(f'Fertilizer Plan — for {size_acres} acres', styles['Heading3']))
        data = [['Stage', 'Urea (kg)', 'TSP (kg)', 'MOP (kg)']]
        for r in rows:
            data.append([str(r.get('stage', ''))[:60], r.get('urea', '-'),
                         r.get('tsp', '-'), r.get('mop', '-')])
        data.append(['Total', totals.get('urea', '-'), totals.get('tsp', '-'), totals.get('mop', '-')])
        ft = Table(data, hAlign='LEFT', colWidths=[80 * mm, 25 * mm, 25 * mm, 25 * mm])
        ft.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#1f2937')),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
            ('GRID', (0, 0), (-1, -1), 0.5, colors.grey),
            ('FONTSIZE', (0, 0), (-1, -1), 9),
            ('FONTNAME', (0, -1), (-1, -1), 'Helvetica-Bold'),
            ('ALIGN', (1, 0), (-1, -1), 'RIGHT'),
        ]))
        story.append(ft)
        story.append(Spacer(1, 14 * mm))

    story.append(Paragraph("Instructor's signature: ______________________________", styles['Normal']))
    doc.build(story)
    buf.seek(0)
    resp = HttpResponse(buf.getvalue(), content_type='application/pdf')
    resp['Content-Disposition'] = f'attachment; filename="fertilizer-plan-{land.land_id}.pdf"'
    return resp


def _sample_dict(s):
    return {'id': s.id, 'n': s.n, 'p': s.p, 'k': s.k, 'ph': s.ph,
            'moisture': s.moisture, 'crop': s.crop}


def _serialize(reading):
    """Shape a Reading row into the JSON the React frontend expects."""
    if reading is None:
        return {
            'n': None, 'p': None, 'k': None,
            'ph': None, 'moisture': None, 'temperature': None,
            'time': None,
        }
    return {
        'id': reading.id,
        'n': reading.n,
        'p': reading.p,
        'k': reading.k,
        'ph': reading.ph,
        'moisture': reading.moisture,
        'temperature': reading.temperature,
        'time': reading.created_at.isoformat(),
    }


@csrf_exempt
def ingest_reading(request):
    """Receive a soil reading pushed by the ESP32 device and persist it.

    Expects a JSON body such as {"n": 210, "p": 34, "k": 180}. Only the keys
    in INGEST_FIELDS are accepted; anything else is ignored. Each accepted
    reading is stored as its own row so the latest value and history survive
    server restarts.
    """
    if request.method != 'POST':
        return JsonResponse({'error': 'POST required'}, status=405)

    try:
        body = json.loads(request.body.decode('utf-8') or '{}')
    except (ValueError, UnicodeDecodeError):
        return JsonResponse({'error': 'invalid JSON body'}, status=400)

    values = {}
    for key in INGEST_FIELDS:
        if key in body and body[key] is not None:
            try:
                values[key] = round(float(body[key]), 1)
            except (TypeError, ValueError):
                pass

    if not values:
        return JsonResponse({'error': 'no recognised fields in body'}, status=400)

    # Reject physically impossible sensor values (garbage from a flaky RS485
    # line, e.g. K=52480). Real soil N/P/K sit well under this bound in mg/kg.
    for key in ('n', 'p', 'k'):
        if key in values and not (0 <= values[key] <= 3000):
            return JsonResponse(
                {'error': f'implausible {key}={values[key]} (0-3000 mg/kg expected)'},
                status=422)

    # Sensor -> field mapping: if the device sends a device_id that matches a
    # registered Field, attach the reading to that field (multi-field support).
    device_id = str(body.get('device_id', '')).strip()[:64]
    matched_field = None
    if device_id:
        values['device_id'] = device_id
        matched_field = Field.objects.filter(device_id=device_id).first()
        if matched_field:
            values['field'] = matched_field

    reading = Reading.objects.create(**values)
    return JsonResponse({
        'ok': True, 'updated': [k for k in values if k not in ('field', 'device_id')],
        'field': matched_field.id if matched_field else None,
        'reading': _serialize(reading),
    })


def latest_reading(request):
    """Return the most recent reading for the frontend to display."""
    return JsonResponse(_serialize(Reading.objects.first()))


def reading_history(request):
    """Return the last 50 readings (most recent last), for trend charts."""
    rows = list(Reading.objects.all()[:50])
    rows.reverse()  # DB gives newest first; frontend expects most-recent last
    return JsonResponse({'readings': [_serialize(r) for r in rows]})


# ----------------------------------------------------------------------------
# Admin / model training (all password-gated via X-Admin-Password)
# ----------------------------------------------------------------------------

def _model_info():
    """Summary of the currently trained model, or an untrained placeholder."""
    model = ml.load(MODEL_PATH)
    total = TrainingSample.objects.count()
    per_crop = {}
    for s in TrainingSample.objects.values_list('crop', flat=True):
        per_crop[s] = per_crop.get(s, 0) + 1
    if not model:
        return {'trained': False, 'accuracy': None, 'classes': [],
                'model_samples': 0, 'total_samples': total, 'per_crop': per_crop}
    return {
        'trained': True,
        'accuracy': model.get('accuracy'),
        'classes': model.get('classes', []),
        'model_samples': model.get('n', 0),
        'total_samples': total,
        'per_crop': per_crop,
    }


@require_admin
def model_info(request):
    return JsonResponse(_model_info())


@csrf_exempt
@require_admin
def train_data(request):
    """GET: list all training samples. POST: add one labelled sample."""
    if request.method == 'GET':
        rows = [_sample_dict(s) for s in TrainingSample.objects.all()]
        return JsonResponse({'samples': rows, 'count': len(rows)})

    if request.method == 'POST':
        try:
            body = json.loads(request.body.decode('utf-8') or '{}')
        except (ValueError, UnicodeDecodeError):
            return JsonResponse({'error': 'invalid JSON body'}, status=400)
        crop = str(body.get('crop', '')).strip()
        if not crop:
            return JsonResponse({'error': 'crop label is required'}, status=400)
        try:
            values = {f: float(body[f]) for f in ml.FEATURES}
        except (KeyError, TypeError, ValueError):
            return JsonResponse({'error': 'n, p, k, ph, moisture are all required numbers'}, status=400)
        s = TrainingSample.objects.create(crop=crop, **values)
        return JsonResponse({'ok': True, 'sample': _sample_dict(s)})

    return JsonResponse({'error': 'GET or POST required'}, status=405)


@csrf_exempt
@require_admin
def train_data_delete(request, pk):
    if request.method != 'POST':
        return JsonResponse({'error': 'POST required'}, status=405)
    deleted, _ = TrainingSample.objects.filter(pk=pk).delete()
    return JsonResponse({'ok': True, 'deleted': deleted})


@csrf_exempt
@require_admin
def train_data_seed(request):
    """Populate the training set with synthetic samples from SEED_RANGES."""
    if request.method != 'POST':
        return JsonResponse({'error': 'POST required'}, status=405)
    try:
        body = json.loads(request.body.decode('utf-8') or '{}')
    except (ValueError, UnicodeDecodeError):
        body = {}
    per_crop = int(body.get('per_crop', 12))
    per_crop = max(3, min(50, per_crop))

    created = 0
    for crop, ranges in SEED_RANGES.items():
        for _ in range(per_crop):
            vals = {}
            for f, (lo, hi) in ranges.items():
                v = random.uniform(lo, hi)
                vals[f] = round(v, 1) if f == 'ph' else round(v)
            TrainingSample.objects.create(crop=crop, **vals)
            created += 1
    return JsonResponse({'ok': True, 'created': created, 'total': TrainingSample.objects.count()})


@csrf_exempt
@require_admin
def train_model(request):
    """Train the KNN model on all stored samples and cache it to disk."""
    if request.method != 'POST':
        return JsonResponse({'error': 'POST required'}, status=405)
    samples = [_sample_dict(s) for s in TrainingSample.objects.all()]
    try:
        model = ml.train(samples)
    except ValueError as exc:
        return JsonResponse({'error': str(exc)}, status=400)
    ml.save(model, MODEL_PATH)
    return JsonResponse({
        'ok': True,
        'accuracy': model['accuracy'],
        'classes': model['classes'],
        'per_crop': model['per_crop'],
        'samples': model['n'],
    })


@csrf_exempt
def predict_crop(request):
    """Predict the best crops for a soil reading using the trained model.

    Open (not admin-gated) so the main app can use it. Body: {n,p,k,ph,moisture}.
    """
    if request.method != 'POST':
        return JsonResponse({'error': 'POST required'}, status=405)
    model = ml.load(MODEL_PATH)
    if not model:
        return JsonResponse({'error': 'model not trained yet'}, status=409)
    try:
        body = json.loads(request.body.decode('utf-8') or '{}')
        feat = {f: float(body[f]) for f in ('n', 'p', 'k')}
        feat['ph'] = float(body.get('ph', model['means'][3]))
        feat['moisture'] = float(body.get('moisture', model['means'][4]))
    except (ValueError, KeyError, TypeError, UnicodeDecodeError):
        return JsonResponse({'error': 'n, p, k are required numbers'}, status=400)
    ranked = ml.predict(model, feat, top=3)
    return JsonResponse({
        'prediction': ranked[0][0] if ranked else None,
        'confidence': round(ranked[0][1], 3) if ranked else None,
        'ranked': [{'crop': c, 'confidence': round(conf, 3)} for c, conf in ranked],
    })


# ----------------------------------------------------------------------------
# Crop guidelines + historical data (Django REST Framework)
# ----------------------------------------------------------------------------

@api_view(['GET'])
def crop_guidelines(request):
    """List every crop guideline (recommended NPK ranges + watering plan)."""
    qs = CropGuideline.objects.all()
    return Response(CropGuidelineSerializer(qs, many=True).data)


@api_view(['GET'])
def crop_guideline_detail(request, crop_key):
    """Return a single crop's guideline by its crop_key (e.g. 'rice')."""
    try:
        crop = CropGuideline.objects.get(crop_key=crop_key)
    except CropGuideline.DoesNotExist:
        return Response({'error': 'unknown crop'}, status=404)
    return Response(CropGuidelineSerializer(crop).data)


@api_view(['GET'])
def readings_history(request):
    """Persisted readings for the history chart/table.

    Query params: ?hours=24 (time window) and/or ?limit=100 (max rows).
    Returns oldest-first so charts read left-to-right.
    """
    qs = Reading.objects.all()

    hours = request.GET.get('hours')
    if hours:
        try:
            since = timezone.now() - timedelta(hours=float(hours))
            qs = qs.filter(created_at__gte=since)
        except ValueError:
            pass

    try:
        limit = int(request.GET.get('limit', 100))
    except (TypeError, ValueError):
        limit = 100
    limit = max(1, min(500, limit))

    rows = list(qs[:limit])
    rows.reverse()  # DB gives newest-first; charts want oldest-first
    return Response(ReadingSerializer(rows, many=True).data)


def _band_status(value, lo, hi):
    """Classify a value against a recommended [lo, hi] band."""
    if value is None:
        return 'unknown'
    if value < lo:
        return 'low'
    if value > hi:
        return 'high'
    return 'optimal'


@api_view(['GET'])
def compare_reading(request):
    """Compare the latest reading against a crop's guideline.

    Query params: ?crop=<crop_key> and ?field=<id> (scope to one land's latest
    reading; omitted only for legacy/no-login callers, which fall back to the
    single most recent reading in the whole table). Returns per-nutrient
    low/optimal/high plus the crop's watering plan, for the guidance panel.
    """
    crop_key = request.GET.get('crop', '')
    try:
        crop = CropGuideline.objects.get(crop_key=crop_key)
    except CropGuideline.DoesNotExist:
        return Response({'error': 'unknown or missing crop'}, status=404)

    qs = Reading.objects.all()
    field_id = request.GET.get('field')
    if field_id:
        qs = qs.filter(field_id=field_id)
    latest = qs.first()
    if latest is None or latest.n is None:
        return Response({'error': 'no readings yet'}, status=404)

    status = {
        'n': _band_status(latest.n, crop.n_min, crop.n_max),
        'p': _band_status(latest.p, crop.p_min, crop.p_max),
        'k': _band_status(latest.k, crop.k_min, crop.k_max),
        'ph': _band_status(latest.ph, crop.ph_min, crop.ph_max),
        'moisture': _band_status(latest.moisture, crop.moisture_min, crop.moisture_max),
    }
    return Response({
        'crop': CropGuidelineSerializer(crop).data,
        'reading': ReadingSerializer(latest).data,
        'status': status,
    })


# ----------------------------------------------------------------------------
# Fields (multi-field / multi-farm support)
# ----------------------------------------------------------------------------

@api_view(['GET', 'POST'])
def fields_list(request):
    """GET: list every registered field. POST: register a new one."""
    if request.method == 'GET':
        return Response(FieldSerializer(Field.objects.all(), many=True).data)

    ser = FieldSerializer(data=request.data)
    ser.is_valid(raise_exception=True)
    ser.save()
    return Response(ser.data, status=201)


@api_view(['GET', 'PUT', 'DELETE'])
def field_detail(request, pk):
    try:
        obj = Field.objects.get(pk=pk)
    except Field.DoesNotExist:
        return Response({'error': 'not found'}, status=404)

    if request.method == 'GET':
        return Response(FieldSerializer(obj).data)

    if request.method == 'PUT':
        ser = FieldSerializer(obj, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        ser.save()
        return Response(ser.data)

    obj.delete()
    return Response({'ok': True})


@api_view(['GET'])
def field_readings(request, pk):
    """Readings recorded for one specific field (multi-field history)."""
    try:
        limit = max(1, min(500, int(request.GET.get('limit', 100))))
    except (TypeError, ValueError):
        limit = 100
    rows = list(Reading.objects.filter(field_id=pk)[:limit])
    rows.reverse()
    return Response(ReadingSerializer(rows, many=True).data)


# ----------------------------------------------------------------------------
# Fertilizer cost estimation
# ----------------------------------------------------------------------------

@api_view(['GET'])
def fertilizer_types(request):
    """Current LKR/kg price for each fertilizer type (Urea / TSP / MOP)."""
    return Response(FertilizerTypeSerializer(FertilizerType.objects.all(), many=True).data)


@csrf_exempt
@require_admin
def fertilizer_type_update(request, key):
    """Admin-only: update a fertilizer's price_per_kg (X-Admin-Password header)."""
    if request.method != 'PUT':
        return JsonResponse({'error': 'PUT required'}, status=405)
    try:
        obj = FertilizerType.objects.get(key=key)
    except FertilizerType.DoesNotExist:
        return JsonResponse({'error': 'unknown fertilizer key'}, status=404)
    try:
        body = json.loads(request.body.decode('utf-8') or '{}')
        obj.price_per_kg = float(body['price_per_kg'])
    except (ValueError, KeyError, TypeError, UnicodeDecodeError):
        return JsonResponse({'error': 'price_per_kg must be a number'}, status=400)
    obj.save()
    return JsonResponse(FertilizerTypeSerializer(obj).data)


@csrf_exempt
@require_admin
def fertilizer_type_create(request):
    """Admin-only: add a new fertilizer type (key, names, price_per_kg)."""
    if request.method != 'POST':
        return JsonResponse({'error': 'POST required'}, status=405)
    try:
        body = json.loads(request.body.decode('utf-8') or '{}')
    except (ValueError, UnicodeDecodeError):
        return JsonResponse({'error': 'invalid JSON body'}, status=400)

    key = str(body.get('key', '')).strip().lower()[:20]
    name_en = str(body.get('name_en', '')).strip()[:50]
    if not key or not name_en:
        return JsonResponse({'error': 'key and name_en are required'}, status=400)
    if FertilizerType.objects.filter(key=key).exists():
        return JsonResponse({'error': f'fertilizer "{key}" already exists'}, status=409)
    try:
        price = float(body.get('price_per_kg', 0) or 0)
        if price < 0:
            raise ValueError
    except (TypeError, ValueError):
        return JsonResponse({'error': 'price_per_kg must be a non-negative number'}, status=400)

    obj = FertilizerType.objects.create(
        key=key, name_en=name_en,
        name_si=str(body.get('name_si', '')).strip()[:50],
        price_per_kg=price,
    )
    return JsonResponse(FertilizerTypeSerializer(obj).data, status=201)


ACRES_TO_HECTARES = 0.404686


@api_view(['POST'])
def estimate_cost(request):
    """Cost a fertilizer plan for a crop + field size and log it.

    Body: {crop_key, size_acres, urea_kg_ha, tsp_kg_ha, mop_kg_ha, field (id, optional)}
    The per-hectare quantities come from the frontend's DOA fertilizer
    programme table (summed across all growth stages); this endpoint turns
    them into a real quantity for the field's area and prices it using the
    fertilizer prices the admin maintains, then persists the result so it
    shows up in the admin cost report and monthly budget chart.
    """
    body = request.data
    crop_key = str(body.get('crop_key', '')).strip()
    if not crop_key:
        return Response({'error': 'crop_key is required'}, status=400)
    try:
        size_acres = float(body.get('size_acres'))
        if size_acres <= 0:
            raise ValueError
    except (TypeError, ValueError):
        return Response({'error': 'size_acres must be a positive number'}, status=400)

    def kg_ha(field_name):
        try:
            return max(0.0, float(body.get(field_name) or 0))
        except (TypeError, ValueError):
            return 0.0

    urea_ha = kg_ha('urea_kg_ha')
    tsp_ha = kg_ha('tsp_kg_ha')
    mop_ha = kg_ha('mop_kg_ha')

    hectares = size_acres * ACRES_TO_HECTARES
    urea_kg = urea_ha * hectares
    tsp_kg = tsp_ha * hectares
    mop_kg = mop_ha * hectares

    prices = {f.key: f.price_per_kg for f in FertilizerType.objects.all()}
    urea_cost = urea_kg * prices.get('urea', 0)
    tsp_cost = tsp_kg * prices.get('tsp', 0)
    mop_cost = mop_kg * prices.get('mop', 0)
    total_cost = urea_cost + tsp_cost + mop_cost

    field_obj = None
    field_id = body.get('field')
    if field_id:
        field_obj = Field.objects.filter(pk=field_id).first()

    estimate = CostEstimate.objects.create(
        field=field_obj, crop_key=crop_key, size_acres=size_acres,
        urea_kg=round(urea_kg, 2), tsp_kg=round(tsp_kg, 2), mop_kg=round(mop_kg, 2),
        urea_cost=round(urea_cost, 2), tsp_cost=round(tsp_cost, 2), mop_cost=round(mop_cost, 2),
        total_cost=round(total_cost, 2),
    )
    return Response({
        'ok': True,
        'prices_used': prices,
        'estimate': CostEstimateSerializer(estimate).data,
    })


@api_view(['GET'])
def cost_estimates_list(request):
    """Recent logged cost estimates, for the admin cost report table."""
    try:
        limit = max(1, min(200, int(request.GET.get('limit', 50))))
    except (TypeError, ValueError):
        limit = 50
    rows = CostEstimate.objects.all()[:limit]
    return Response(CostEstimateSerializer(rows, many=True).data)


@api_view(['GET'])
def cost_summary(request):
    """Month-by-month total estimated cost, for the admin budget chart.

    Query param: ?months=6 (how many recent calendar months to include).
    """
    try:
        months = max(1, min(24, int(request.GET.get('months', 6))))
    except (TypeError, ValueError):
        months = 6

    since = timezone.now() - timedelta(days=31 * months)
    rows = CostEstimate.objects.filter(created_at__gte=since)

    buckets = {}  # 'YYYY-MM' -> total
    for r in rows:
        key = r.created_at.strftime('%Y-%m')
        buckets[key] = buckets.get(key, 0.0) + r.total_cost

    series = [{'month': k, 'total_cost': round(v, 2)} for k, v in sorted(buckets.items())]
    return Response({'months': months, 'series': series, 'grand_total': round(sum(buckets.values()), 2)})


@api_view(['GET'])
def region_fertilizer(request):
    """Fertilizer demand aggregated by Sri Lanka district.

    For each region we roll up the registered lands and the fertilizer their
    logged cost estimates call for (Urea / TSP / MOP kg + total LKR), so an
    admin can see, at a glance, which districts need how much fertilizer. This
    is the national picture: every registered farmer feeds into it.
    """
    regions = {}  # region -> aggregate

    def bucket(name):
        name = name or 'Unspecified'
        if name not in regions:
            regions[name] = {'region': name, 'lands': 0, 'urea_kg': 0.0,
                             'tsp_kg': 0.0, 'mop_kg': 0.0, 'total_cost': 0.0,
                             'crops': {}}
        return regions[name]

    # Land counts + crop mix per region.
    for f in Field.objects.filter(land_id__isnull=False):
        b = bucket(f.region)
        b['lands'] += 1
        if f.crop_key:
            b['crops'][f.crop_key] = b['crops'].get(f.crop_key, 0) + 1

    # Fertilizer quantities from each land's logged cost estimates.
    for e in CostEstimate.objects.select_related('field').all():
        region = e.field.region if e.field else None
        b = bucket(region)
        b['urea_kg'] += e.urea_kg or 0
        b['tsp_kg'] += e.tsp_kg or 0
        b['mop_kg'] += e.mop_kg or 0
        b['total_cost'] += e.total_cost or 0

    rows = []
    for b in regions.values():
        top_crop = max(b['crops'].items(), key=lambda kv: kv[1])[0] if b['crops'] else None
        rows.append({
            'region': b['region'], 'lands': b['lands'],
            'urea_kg': round(b['urea_kg'], 1), 'tsp_kg': round(b['tsp_kg'], 1),
            'mop_kg': round(b['mop_kg'], 1), 'total_cost': round(b['total_cost'], 2),
            'top_crop': top_crop,
        })
    rows.sort(key=lambda r: (-r['lands'], r['region']))
    totals = {
        'lands': sum(r['lands'] for r in rows),
        'urea_kg': round(sum(r['urea_kg'] for r in rows), 1),
        'tsp_kg': round(sum(r['tsp_kg'] for r in rows), 1),
        'mop_kg': round(sum(r['mop_kg'] for r in rows), 1),
        'total_cost': round(sum(r['total_cost'] for r in rows), 2),
    }
    return Response({'regions': rows, 'totals': totals})


# Broad soil sufficiency bands (mg/kg for N/P/K, ratio for pH) used to score a
# district's *average* soil health independent of any one crop — a coarse
# "is this district's soil in a healthy general range" signal for policy.
_SOIL_BANDS = {
    'n': (80, 250), 'p': (20, 60), 'k': (110, 320), 'ph': (5.5, 7.5), 'moisture': (40, 80),
}


def _health_score(avgs):
    """0-100 score: share of averaged nutrients sitting in their healthy band,
    with a partial penalty (not zero) for values just outside it."""
    parts = []
    for key, (lo, hi) in _SOIL_BANDS.items():
        v = avgs.get(key)
        if v is None:
            continue
        if lo <= v <= hi:
            parts.append(100)
        else:
            span = hi - lo
            dist = (lo - v) if v < lo else (v - hi)
            parts.append(max(0, 100 - (dist / span) * 100))
    return round(sum(parts) / len(parts)) if parts else None


@api_view(['GET'])
def region_soil_health(request):
    """Average soil nutrients per district + a coarse health score.

    Uses each registered land's most recent reading, averaged by district, so
    government/agronomists can see regional soil health at a glance (and spot
    over/under-fertilised areas) — the national soil-data picture behind the
    fertiliser-policy motivation. Districts with no readings yet are reported
    with lands>0 but null averages so the map still shows them.
    """
    regions = {}

    for f in Field.objects.filter(land_id__isnull=False):
        name = f.region or 'Unspecified'
        b = regions.setdefault(name, {'region': name, 'lands': 0,
                                       'sums': {k: 0.0 for k in _SOIL_BANDS}, 'counts': {k: 0 for k in _SOIL_BANDS}})
        b['lands'] += 1
        latest = Reading.objects.filter(field=f).first()
        if latest:
            for key in _SOIL_BANDS:
                val = getattr(latest, key, None)
                if val is not None:
                    b['sums'][key] += val
                    b['counts'][key] += 1

    rows = []
    for b in regions.values():
        avgs = {k: (round(b['sums'][k] / b['counts'][k], 1) if b['counts'][k] else None) for k in _SOIL_BANDS}
        rows.append({
            'region': b['region'], 'lands': b['lands'],
            'readings': max(b['counts'].values()) if b['counts'] else 0,
            **{f'avg_{k}': avgs[k] for k in _SOIL_BANDS},
            'health': _health_score(avgs),
        })
    rows.sort(key=lambda r: (-(r['health'] if r['health'] is not None else -1), r['region']))
    return Response({'regions': rows, 'bands': _SOIL_BANDS})


@api_view(['GET'])
def region_crops(request):
    """What crops are grown across all registered lands (national crop map).

    Two views of the same data for the government portal:
      - `crops`: each crop with how many lands grow it and their total acreage
        (national "what is being cultivated" picture, biggest first).
      - `regions`: per-district crop breakdown + that district's top crop, so an
        officer can see what each area is growing.
    Only registered lands (land_id set) count; lands with no crop chosen yet are
    tallied under `no_crop` so the totals still add up.
    """
    crop_tot = {}   # crop_key -> {crop_key, lands, acres}
    regions = {}    # region -> {region, lands, crops:{crop_key:count}, no_crop}

    for f in Field.objects.filter(land_id__isnull=False):
        region = f.region or 'Unspecified'
        rb = regions.setdefault(region, {'region': region, 'lands': 0, 'crops': {}, 'no_crop': 0})
        rb['lands'] += 1
        crop = f.crop_key or ''
        if not crop:
            rb['no_crop'] += 1
            continue
        rb['crops'][crop] = rb['crops'].get(crop, 0) + 1
        c = crop_tot.setdefault(crop, {'crop_key': crop, 'lands': 0, 'acres': 0.0})
        c['lands'] += 1
        c['acres'] += f.size_acres or 0

    crops = sorted(crop_tot.values(), key=lambda c: (-c['lands'], c['crop_key']))
    for c in crops:
        c['acres'] = round(c['acres'], 2)

    region_rows = []
    for rb in regions.values():
        top = max(rb['crops'].items(), key=lambda kv: kv[1])[0] if rb['crops'] else None
        region_rows.append({
            'region': rb['region'], 'lands': rb['lands'],
            'crops': rb['crops'], 'top_crop': top,
            'distinct_crops': len(rb['crops']), 'no_crop': rb['no_crop'],
        })
    region_rows.sort(key=lambda r: (-r['lands'], r['region']))

    return Response({
        'crops': crops,
        'regions': region_rows,
        'totals': {
            'lands': sum(c['lands'] for c in crops),
            'acres': round(sum(c['acres'] for c in crops), 2),
            'crops_count': len(crops),
        },
    })


# ----------------------------------------------------------------------------
# Historical trend forecasting (pure-Python linear trend, see trend.py)
# ----------------------------------------------------------------------------

@api_view(['GET'])
def predict_trend(request):
    """Forecast N/P/K a few days out from stored reading history.

    Query params: ?hours=720 (lookback window, default 30 days),
    ?horizon_days=7 (how far ahead to project), ?field=<id> (optional filter).
    With too few readings this honestly reports 'sufficient_data': False
    instead of extrapolating from noise.
    """
    try:
        hours = float(request.GET.get('hours', 720))
    except (TypeError, ValueError):
        hours = 720
    try:
        horizon_days = float(request.GET.get('horizon_days', 7))
    except (TypeError, ValueError):
        horizon_days = 7

    since = timezone.now() - timedelta(hours=hours)
    qs = Reading.objects.filter(created_at__gte=since)
    field_id = request.GET.get('field')
    if field_id:
        qs = qs.filter(field_id=field_id)

    rows = list(qs.order_by('created_at'))
    result = {}
    for nutrient in ('n', 'p', 'k'):
        points = [(r.created_at, getattr(r, nutrient)) for r in rows]
        result[nutrient] = trend.forecast_nutrient(points, horizon_days=horizon_days)

    return Response({'lookback_hours': hours, 'readings_considered': len(rows), 'forecast': result})


# ----------------------------------------------------------------------------
# Farms (multi-farm support) — CRUD
# ----------------------------------------------------------------------------

@api_view(['GET', 'POST'])
def farms_list(request):
    if request.method == 'GET':
        return Response(FarmSerializer(Farm.objects.all(), many=True).data)
    ser = FarmSerializer(data=request.data)
    ser.is_valid(raise_exception=True)
    ser.save()
    return Response(ser.data, status=201)


@api_view(['GET', 'PUT', 'DELETE'])
def farm_detail(request, pk):
    try:
        obj = Farm.objects.get(pk=pk)
    except Farm.DoesNotExist:
        return Response({'error': 'not found'}, status=404)
    if request.method == 'GET':
        return Response(FarmSerializer(obj).data)
    if request.method == 'PUT':
        ser = FarmSerializer(obj, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        ser.save()
        return Response(ser.data)
    obj.delete()
    return Response({'ok': True})


# ----------------------------------------------------------------------------
# Data export — Excel (openpyxl) and PDF (reportlab)
# ----------------------------------------------------------------------------

def _xlsx_response(filename, headers, rows):
    """Build an .xlsx download from a header list + list-of-row-lists."""
    from openpyxl import Workbook
    from openpyxl.styles import Font

    wb = Workbook()
    ws = wb.active
    ws.title = filename.split('.')[0][:31]
    ws.append(headers)
    for cell in ws[1]:
        cell.font = Font(bold=True)
    for row in rows:
        ws.append(row)
    for i, _ in enumerate(headers, start=1):
        ws.column_dimensions[chr(64 + i)].width = 16

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    resp = HttpResponse(
        buf.getvalue(),
        content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )
    resp['Content-Disposition'] = f'attachment; filename="{filename}"'
    return resp


def export_readings_xlsx(request):
    """Download recent sensor readings as an Excel file."""
    try:
        limit = max(1, min(5000, int(request.GET.get('limit', 500))))
    except (TypeError, ValueError):
        limit = 500
    qs = Reading.objects.all()
    field_id = request.GET.get('field')
    if field_id:
        qs = qs.filter(field_id=field_id)
    rows = [
        [r.created_at.strftime('%Y-%m-%d %H:%M:%S'), r.n, r.p, r.k, r.ph, r.moisture,
         r.temperature, r.device_id or '', r.field.name if r.field else '']
        for r in qs[:limit]
    ]
    return _xlsx_response(
        'readings.xlsx',
        ['Time', 'N (mg/kg)', 'P (mg/kg)', 'K (mg/kg)', 'pH', 'Moisture %', 'Temp °C', 'Device', 'Field'],
        rows,
    )


def export_cost_xlsx(request):
    """Download logged fertilizer cost estimates as an Excel file."""
    rows = [
        [c.created_at.strftime('%Y-%m-%d %H:%M'), c.field.name if c.field else '', c.crop_key,
         c.size_acres, c.urea_kg, c.tsp_kg, c.mop_kg, c.urea_cost, c.tsp_cost, c.mop_cost, c.total_cost]
        for c in CostEstimate.objects.all()[:2000]
    ]
    return _xlsx_response(
        'cost_estimates.xlsx',
        ['Time', 'Field', 'Crop', 'Size (ac)', 'Urea kg', 'TSP kg', 'MOP kg',
         'Urea LKR', 'TSP LKR', 'MOP LKR', 'Total LKR'],
        rows,
    )


def export_report_pdf(request):
    """A one-page PDF summary: latest reading, recent cost estimates, totals."""
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.lib import colors
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
    from reportlab.lib.styles import getSampleStyleSheet

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, title='Soil Report',
                            topMargin=18 * mm, bottomMargin=18 * mm)
    styles = getSampleStyleSheet()
    story = [Paragraph('Soil Nutrient Monitoring — Summary Report', styles['Title'])]
    story.append(Paragraph(timezone.now().strftime('Generated %Y-%m-%d %H:%M'), styles['Normal']))
    story.append(Spacer(1, 8 * mm))

    latest = Reading.objects.first()
    story.append(Paragraph('Latest Reading', styles['Heading2']))
    if latest and latest.n is not None:
        data = [['N', 'P', 'K', 'pH', 'Moisture', 'Time'],
                [latest.n, latest.p, latest.k, latest.ph if latest.ph is not None else '-',
                 latest.moisture if latest.moisture is not None else '-',
                 latest.created_at.strftime('%Y-%m-%d %H:%M')]]
        t = Table(data, hAlign='LEFT')
        t.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#059669')),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
            ('GRID', (0, 0), (-1, -1), 0.5, colors.grey),
            ('FONTSIZE', (0, 0), (-1, -1), 9),
        ]))
        story.append(t)
    else:
        story.append(Paragraph('No readings recorded yet.', styles['Normal']))
    story.append(Spacer(1, 8 * mm))

    story.append(Paragraph('Recent Fertilizer Cost Estimates', styles['Heading2']))
    estimates = list(CostEstimate.objects.all()[:15])
    if estimates:
        data = [['Time', 'Field', 'Crop', 'Size', 'Total (LKR)']]
        for c in estimates:
            data.append([c.created_at.strftime('%m-%d %H:%M'), (c.field.name if c.field else '-'),
                         c.crop_key, f'{c.size_acres} ac', f'{c.total_cost:,.0f}'])
        grand = sum(c.total_cost for c in estimates)
        data.append(['', '', '', 'Total', f'{grand:,.0f}'])
        t = Table(data, hAlign='LEFT')
        t.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#059669')),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
            ('GRID', (0, 0), (-1, -1), 0.5, colors.grey),
            ('FONTSIZE', (0, 0), (-1, -1), 9),
            ('BACKGROUND', (0, -1), (-1, -1), colors.HexColor('#ecfdf5')),
            ('FONTNAME', (0, -1), (-1, -1), 'Helvetica-Bold'),
        ]))
        story.append(t)
    else:
        story.append(Paragraph('No cost estimates recorded yet.', styles['Normal']))

    doc.build(story)
    buf.seek(0)
    resp = HttpResponse(buf.getvalue(), content_type='application/pdf')
    resp['Content-Disposition'] = 'attachment; filename="soil_report.pdf"'
    return resp


# ----------------------------------------------------------------------------
# Seasonal comparison analytics — compare two date ranges
# ----------------------------------------------------------------------------

def _avg_readings(qs):
    """Average N/P/K/pH/moisture over a queryset, ignoring nulls per field."""
    out = {}
    for key in ('n', 'p', 'k', 'ph', 'moisture'):
        vals = [getattr(r, key) for r in qs if getattr(r, key) is not None]
        out[key] = round(sum(vals) / len(vals), 1) if vals else None
    return out


@api_view(['GET'])
def season_compare(request):
    """Compare average NPK/pH/moisture between two periods.

    Query params: a_start, a_end, b_start, b_end (YYYY-MM-DD). If omitted,
    defaults to "this month" (A) vs "previous month" (B). Also returns the
    per-nutrient delta and direction so the frontend can render a comparison.
    """
    today = timezone.now().date()

    def rng(prefix, default_start, default_end):
        s = parse_date(request.GET.get(f'{prefix}_start', '') or '') or default_start
        e = parse_date(request.GET.get(f'{prefix}_end', '') or '') or default_end
        return s, e

    first_of_this = today.replace(day=1)
    last_month_end = first_of_this - timedelta(days=1)
    first_of_last = last_month_end.replace(day=1)

    a_start, a_end = rng('a', first_of_this, today)
    b_start, b_end = rng('b', first_of_last, last_month_end)

    def period(start, end):
        # inclusive of the end date
        qs = Reading.objects.filter(created_at__date__gte=start, created_at__date__lte=end)
        field_id = request.GET.get('field')
        if field_id:
            qs = qs.filter(field_id=field_id)
        rows = list(qs)
        return {'start': str(start), 'end': str(end), 'count': len(rows), 'avg': _avg_readings(rows)}

    a = period(a_start, a_end)
    b = period(b_start, b_end)

    deltas = {}
    for key in ('n', 'p', 'k', 'ph', 'moisture'):
        av, bv = a['avg'][key], b['avg'][key]
        if av is None or bv is None:
            deltas[key] = None
        else:
            diff = round(av - bv, 1)
            deltas[key] = {'diff': diff, 'direction': 'up' if diff > 0 else 'down' if diff < 0 else 'flat'}

    return Response({'a': a, 'b': b, 'deltas': deltas})
