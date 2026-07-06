from django.contrib import admin

from .models import Reading, CropGuideline, TrainingSample, Field, FertilizerType, CostEstimate, Farm


@admin.register(Reading)
class ReadingAdmin(admin.ModelAdmin):
    list_display = ('id', 'n', 'p', 'k', 'ph', 'moisture', 'temperature', 'field', 'device_id', 'created_at')
    list_filter = ('field',)
    date_hierarchy = 'created_at'


@admin.register(Farm)
class FarmAdmin(admin.ModelAdmin):
    list_display = ('id', 'name', 'owner_name', 'location', 'created_at')
    search_fields = ('name', 'owner_name')


@admin.register(Field)
class FieldAdmin(admin.ModelAdmin):
    list_display = ('id', 'name', 'farm', 'size_acres', 'crop_key', 'device_id', 'updated_at')
    list_filter = ('farm',)
    search_fields = ('name', 'device_id')


@admin.register(FertilizerType)
class FertilizerTypeAdmin(admin.ModelAdmin):
    list_display = ('key', 'name_en', 'price_per_kg', 'updated_at')


@admin.register(CostEstimate)
class CostEstimateAdmin(admin.ModelAdmin):
    list_display = ('id', 'field', 'crop_key', 'size_acres', 'total_cost', 'created_at')
    list_filter = ('crop_key', 'field')
    date_hierarchy = 'created_at'


@admin.register(CropGuideline)
class CropGuidelineAdmin(admin.ModelAdmin):
    list_display = ('crop_key', 'name_en', 'n_min', 'n_max', 'p_min', 'p_max', 'k_min', 'k_max')


@admin.register(TrainingSample)
class TrainingSampleAdmin(admin.ModelAdmin):
    list_display = ('id', 'crop', 'n', 'p', 'k', 'ph', 'moisture', 'created_at')
    list_filter = ('crop',)
