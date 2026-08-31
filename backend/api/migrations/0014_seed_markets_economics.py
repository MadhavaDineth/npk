from django.db import migrations


# Well-known Sri Lankan wholesale/retail markets (Dedicated Economic Centres).
MARKETS = [
    ('dambulla',       'Dambulla DEC',          'දඹුල්ල',       'Matale'),
    ('meegoda',        'Meegoda DEC',           'මීගොඩ',        'Colombo'),
    ('narahenpita',    'Narahenpita Market',    'නාරාහේන්පිට',   'Colombo'),
    ('keppetipola',    'Keppetipola DEC',       'කැප්පෙටිපොල',   'Badulla'),
    ('thambuttegama',  'Thambuttegama DEC',     'තඹුත්තේගම',     'Anuradhapura'),
    ('colombo_manning', 'Colombo Manning Market', 'කොළඹ මැනිං',  'Colombo'),
]

# Per-acre starting defaults (LKR / kg). Rough placeholders — admin edits these.
# (yield_kg_per_acre, fertilizer, labor, seed, other)
ECONOMICS = {
    'rice':    (2000, 18000, 35000, 5000, 12000),
    'maize':   (1600, 15000, 25000, 4000,  8000),
    'tomato':  (8000, 30000, 60000, 8000, 20000),
    'chili':   (4000, 28000, 55000, 7000, 18000),
    'okra':    (3000, 20000, 40000, 5000, 12000),
    'brinjal': (8000, 28000, 55000, 7000, 18000),
}


def seed(apps, schema_editor):
    Market = apps.get_model('api', 'Market')
    CropEconomics = apps.get_model('api', 'CropEconomics')

    for key, name_en, name_si, district in MARKETS:
        Market.objects.get_or_create(
            key=key,
            defaults={'name_en': name_en, 'name_si': name_si, 'district': district},
        )

    for crop_key, (y, fert, labor, seed_c, other) in ECONOMICS.items():
        CropEconomics.objects.get_or_create(
            crop_key=crop_key,
            defaults={
                'yield_kg_per_acre': y,
                'fertilizer_cost_per_acre': fert,
                'labor_cost_per_acre': labor,
                'seed_cost_per_acre': seed_c,
                'other_cost_per_acre': other,
            },
        )


def unseed(apps, schema_editor):
    Market = apps.get_model('api', 'Market')
    CropEconomics = apps.get_model('api', 'CropEconomics')
    Market.objects.filter(key__in=[m[0] for m in MARKETS]).delete()
    CropEconomics.objects.filter(crop_key__in=list(ECONOMICS)).delete()


class Migration(migrations.Migration):
    dependencies = [
        ('api', '0013_cropeconomics_market_marketprice'),
    ]
    operations = [
        migrations.RunPython(seed, unseed),
    ]
