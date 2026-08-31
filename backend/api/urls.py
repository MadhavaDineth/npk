from django.urls import path

from . import views

urlpatterns = [
    # ESP32 device pushes readings here; the React frontend polls latest/history.
    path('reading/', views.ingest_reading, name='ingest_reading'),
    path('latest/', views.latest_reading, name='latest_reading'),
    path('history/', views.reading_history, name='reading_history'),

    # Land accounts (a land is the login unit: register -> Land ID + password).
    path('land/register/', views.land_register, name='land_register'),
    path('land/login/', views.land_login, name='land_login'),
    path('land/logout/', views.land_logout, name='land_logout'),
    path('land/me/', views.land_me, name='land_me'),
    path('land/update/', views.land_update, name='land_update'),
    path('land/latest/', views.land_latest, name='land_latest'),
    path('land/history/', views.land_history, name='land_history'),
    path('land/reading/', views.land_reading, name='land_reading'),
    path('land/anomalies/', views.land_anomalies, name='land_anomalies'),
    path('land/plan.pdf', views.land_plan_pdf, name='land_plan_pdf'),

    # Staff accounts + role-based access (government / agronomist / admin).
    path('staff/login/', views.staff_login, name='staff_login'),
    path('staff/me/', views.staff_me, name='staff_me'),
    path('staff/create/', views.staff_create, name='staff_create'),
    path('staff/list/', views.staff_list, name='staff_list'),

    # Crop guidelines + historical data (DRF).
    path('crops/', views.crop_guidelines, name='crop_guidelines'),
    path('crops/<str:crop_key>/guideline/', views.crop_guideline_detail, name='crop_guideline_detail'),
    path('crops/<str:crop_key>/price/', views.crop_price_update, name='crop_price_update'),

    # Crop economics: markets, daily market prices, per-crop yield/cost, profit.
    path('markets/', views.markets_list, name='markets_list'),
    path('market-prices/', views.market_prices, name='market_prices'),
    path('market-prices/set/', views.market_price_set, name='market_price_set'),
    path('crop-economics/', views.crop_economics_list, name='crop_economics_list'),
    path('crop-economics/<str:crop_key>/', views.crop_economics_update, name='crop_economics_update'),
    path('land/profit/', views.land_profit, name='land_profit'),
    path('land/profit-predict/', views.land_profit_predict, name='land_profit_predict'),
    path('readings/', views.readings_history, name='readings_history'),
    path('compare/', views.compare_reading, name='compare_reading'),
    path('predict-trend/', views.predict_trend, name='predict_trend'),

    # Fields + Farms (multi-field / multi-farm support).
    path('fields/', views.fields_list, name='fields_list'),
    path('fields/<int:pk>/', views.field_detail, name='field_detail'),
    path('fields/<int:pk>/readings/', views.field_readings, name='field_readings'),
    path('farms/', views.farms_list, name='farms_list'),
    path('farms/<int:pk>/', views.farm_detail, name='farm_detail'),

    # Data export (Excel / PDF) and seasonal analytics.
    path('export/readings.xlsx', views.export_readings_xlsx, name='export_readings_xlsx'),
    path('export/cost.xlsx', views.export_cost_xlsx, name='export_cost_xlsx'),
    path('export/report.pdf', views.export_report_pdf, name='export_report_pdf'),
    path('season-compare/', views.season_compare, name='season_compare'),

    # Fertilizer cost estimation.
    path('fertilizer-types/', views.fertilizer_types, name='fertilizer_types'),
    path('fertilizer-types/create/', views.fertilizer_type_create, name='fertilizer_type_create'),
    path('fertilizer-types/<str:key>/update/', views.fertilizer_type_update, name='fertilizer_type_update'),
    path('estimate-cost/', views.estimate_cost, name='estimate_cost'),
    path('cost-estimates/', views.cost_estimates_list, name='cost_estimates_list'),
    path('cost-summary/', views.cost_summary, name='cost_summary'),
    path('region-fertilizer/', views.region_fertilizer, name='region_fertilizer'),
    path('region-soil-health/', views.region_soil_health, name='region_soil_health'),
    path('region-crops/', views.region_crops, name='region_crops'),

    # Admin / crop-recommendation model training (password-gated).
    path('model-info/', views.model_info, name='model_info'),
    path('train-data/', views.train_data, name='train_data'),
    path('train-data/<int:pk>/delete/', views.train_data_delete, name='train_data_delete'),
    path('train-data/seed/', views.train_data_seed, name='train_data_seed'),
    path('train/', views.train_model, name='train_model'),
    path('predict/', views.predict_crop, name='predict_crop'),
]
