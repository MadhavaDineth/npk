from django.db import migrations

# Starting LKR/kg prices (approx. Sri Lanka retail, 2026) — admin-editable
# afterward from the React Admin panel or the Django admin site.
PRICES = [
    ('urea', 'Urea', 'යූරියා', 45.0),
    ('tsp', 'TSP', 'ට්‍රිපල් සුපර් පොස්පේට්', 60.0),
    ('mop', 'MOP', 'මියුරේට් ඔෆ් පොටෑෂ්', 75.0),
]


def seed(apps, schema_editor):
    FertilizerType = apps.get_model('api', 'FertilizerType')
    for key, name_en, name_si, price in PRICES:
        FertilizerType.objects.update_or_create(
            key=key, defaults=dict(name_en=name_en, name_si=name_si, price_per_kg=price),
        )


def unseed(apps, schema_editor):
    FertilizerType = apps.get_model('api', 'FertilizerType')
    FertilizerType.objects.filter(key__in=[p[0] for p in PRICES]).delete()


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0005_fertilizertype_field_costestimate_reading_field'),
    ]

    operations = [
        migrations.RunPython(seed, unseed),
    ]
