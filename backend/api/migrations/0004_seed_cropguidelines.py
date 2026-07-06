from django.db import migrations


# crop_key: (name_en, name_si, n_min, n_max, p_min, p_max, k_min, k_max,
#            ph_min, ph_max, moist_min, moist_max, water_days, water_mm,
#            notes_en, notes_si)
CROPS = [
    ('rice', 'Rice', 'වී', 280, 560, 10, 25, 110, 280, 5.5, 6.5, 70, 90, 2, 40,
     'High nitrogen demand; keep the field consistently wet.',
     'නයිට්‍රජන් ඉහළ ලෙස අවශ්‍යයි; කුඹුර නිතරම තෙතට තබන්න.'),
    ('tomato', 'Tomato', 'තක්කාලි', 200, 300, 50, 80, 200, 300, 6.0, 6.8, 60, 80, 3, 25,
     'Needs strong potassium and calcium to avoid blossom-end rot.',
     'මල් අග කුණුවීම වැළැක්වීමට පොටෑසියම් හා කැල්සියම් වැදගත්.'),
    ('chili', 'Chili', 'මිරිස්', 150, 250, 40, 60, 150, 250, 6.0, 6.5, 60, 75, 3, 20,
     'Moderate feeder; avoid waterlogging.',
     'මධ්‍යම පොහොර; ජලය රැඳීම වළක්වන්න.'),
    ('maize', 'Maize', 'බඩඉරිඟු', 250, 400, 30, 50, 150, 250, 5.8, 7.0, 60, 75, 4, 30,
     'Heavy nitrogen feeder, especially at the vegetative stage.',
     'විශේෂයෙන් වර්ධන අවධියේ නයිට්‍රජන් වැඩිපුර අවශ්‍යයි.'),
    ('brinjal', 'Brinjal', 'වම්බටු', 180, 280, 40, 70, 180, 280, 5.5, 6.8, 60, 80, 3, 25,
     'Long-season crop; steady potassium supports fruiting.',
     'දිගු කාල බෝගයක්; ස්ථාවර පොටෑසියම් ඵල හටගැනීමට උදව් වේ.'),
    ('okra', 'Okra', 'බණ්ඩක්කා', 150, 250, 30, 50, 150, 230, 6.0, 6.8, 55, 75, 4, 20,
     'Warm-season crop; tolerates lighter watering.',
     'උණුසුම් කාල බෝගයක්; අඩු ජලයට ඔරොත්තු දෙයි.'),
]


def seed(apps, schema_editor):
    CropGuideline = apps.get_model('api', 'CropGuideline')
    for row in CROPS:
        (crop_key, name_en, name_si, n_min, n_max, p_min, p_max, k_min, k_max,
         ph_min, ph_max, m_min, m_max, water_days, water_mm, notes_en, notes_si) = row
        CropGuideline.objects.update_or_create(
            crop_key=crop_key,
            defaults=dict(
                name_en=name_en, name_si=name_si,
                n_min=n_min, n_max=n_max, p_min=p_min, p_max=p_max,
                k_min=k_min, k_max=k_max, ph_min=ph_min, ph_max=ph_max,
                moisture_min=m_min, moisture_max=m_max,
                water_frequency_days=water_days, water_amount_mm=water_mm,
                notes_en=notes_en, notes_si=notes_si,
            ),
        )


def unseed(apps, schema_editor):
    CropGuideline = apps.get_model('api', 'CropGuideline')
    CropGuideline.objects.filter(crop_key__in=[c[0] for c in CROPS]).delete()


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0003_cropguideline'),
    ]

    operations = [
        migrations.RunPython(seed, unseed),
    ]
