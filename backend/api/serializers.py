from rest_framework import serializers

from .models import (Reading, CropGuideline, Field, FertilizerType, CostEstimate, Farm,
                     Market, MarketPrice, CropEconomics)


class ReadingSerializer(serializers.ModelSerializer):
    # Expose created_at as `time` (ISO string) to match the frontend schema.
    time = serializers.DateTimeField(source='created_at', read_only=True)

    class Meta:
        model = Reading
        fields = ['id', 'n', 'p', 'k', 'ph', 'moisture', 'temperature', 'field', 'device_id', 'time']


class CropGuidelineSerializer(serializers.ModelSerializer):
    class Meta:
        model = CropGuideline
        fields = '__all__'


class FarmSerializer(serializers.ModelSerializer):
    field_count = serializers.IntegerField(source='fields.count', read_only=True)

    class Meta:
        model = Farm
        fields = ['id', 'name', 'owner_name', 'location', 'latitude', 'longitude', 'field_count', 'created_at']


class FieldSerializer(serializers.ModelSerializer):
    farm_name = serializers.CharField(source='farm.name', read_only=True, default=None)

    class Meta:
        model = Field
        # land_id is exposed read-only; password_hash / auth_token are never
        # serialised (the login/register responses hand the token back once).
        fields = ['id', 'farm', 'farm_name', 'name', 'details', 'size_acres', 'crop_key', 'mode',
                  'device_id', 'latitude', 'longitude', 'land_id',
                  'owner_name', 'contact_number', 'region', 'created_at', 'updated_at']
        read_only_fields = ['land_id']


class FertilizerTypeSerializer(serializers.ModelSerializer):
    class Meta:
        model = FertilizerType
        fields = ['id', 'key', 'name_en', 'name_si', 'price_per_kg', 'updated_at']


class CostEstimateSerializer(serializers.ModelSerializer):
    field_name = serializers.CharField(source='field.name', read_only=True, default=None)

    class Meta:
        model = CostEstimate
        fields = ['id', 'field', 'field_name', 'crop_key', 'size_acres', 'urea_kg', 'tsp_kg', 'mop_kg',
                  'urea_cost', 'tsp_cost', 'mop_cost', 'total_cost', 'created_at']


class MarketSerializer(serializers.ModelSerializer):
    class Meta:
        model = Market
        fields = ['id', 'key', 'name_en', 'name_si', 'district', 'active']


class MarketPriceSerializer(serializers.ModelSerializer):
    market_key = serializers.CharField(source='market.key', read_only=True)
    market_name = serializers.CharField(source='market.name_en', read_only=True)

    class Meta:
        model = MarketPrice
        fields = ['id', 'market', 'market_key', 'market_name', 'crop_key',
                  'price_per_kg', 'date', 'updated_at']


class CropEconomicsSerializer(serializers.ModelSerializer):
    total_cost_per_acre = serializers.FloatField(read_only=True)

    class Meta:
        model = CropEconomics
        fields = ['id', 'crop_key', 'yield_kg_per_acre', 'fertilizer_cost_per_acre',
                  'labor_cost_per_acre', 'seed_cost_per_acre', 'other_cost_per_acre',
                  'total_cost_per_acre', 'updated_at']
