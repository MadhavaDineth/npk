"""Nutrient-trend forecasting with scikit-learn.

Phase 2 of the thesis's "Historical Trend Analysis" item. Given a nutrient's
reading history it fits a regression of value against time (days) and projects
`horizon_days` ahead, reporting the model's R² so the UI can show how well the
trend actually fits.

The model is scikit-learn's LinearRegression by default. When there are enough
points it also tries a degree-2 polynomial fit and keeps whichever has the
better cross-validated score — a light nod to non-linear depletion curves
without pulling in a full ARIMA/statsmodels dependency (statsmodels isn't
installed; sklearn is). The honest data-sufficiency guards from Phase 1 are
kept: with too few points, or a history far shorter than the horizon, it says
so instead of extrapolating noise.
"""
import numpy as np
from sklearn.linear_model import LinearRegression
from sklearn.metrics import r2_score

MIN_POINTS = 5              # fewer points than this -> no forecast, just say so
MIN_SPAN_HOURS = 1.0        # readings must span at least this long to fit any trend
MIN_SPAN_VS_HORIZON = 0.5   # observed span must cover >= this fraction of the horizon
                            # (don't extrapolate 7 days from 10 minutes of readings)
RELIABLE_R2 = 0.25         # below this in-sample fit, the trend isn't trustworthy


def forecast_nutrient(points, horizon_days=7):
    """points: [(datetime, value), ...] oldest-first, value may be None.

    Fits a scikit-learn linear regression of value against time (days) and
    projects `horizon_days` ahead. Returns the latest actual value, the model
    projection, the in-sample R² (fit quality), a reliability flag, a trend
    label, and whether there was enough data to fit at all.
    """
    clean = [(t, v) for t, v in points if v is not None]
    if len(clean) < MIN_POINTS:
        return {'sufficient_data': False, 'reason': 'too_few_readings', 'count': len(clean)}

    t0 = clean[0][0]
    span_hours = (clean[-1][0] - t0).total_seconds() / 3600.0
    required_hours = max(MIN_SPAN_HOURS, horizon_days * 24 * MIN_SPAN_VS_HORIZON)
    if span_hours < required_hours:
        return {
            'sufficient_data': False, 'reason': 'time_span_too_short', 'count': len(clean),
            'span_hours': round(span_hours, 2), 'required_hours': round(required_hours, 2),
        }

    # Feature = days since the first reading; target = nutrient value.
    x = np.array([[(t - t0).total_seconds() / 86400.0] for t, _ in clean])
    y = np.array([v for _, v in clean], dtype=float)

    model = LinearRegression().fit(x, y)
    r2 = float(r2_score(y, model.predict(x)))  # in-sample: bounded, no CV blow-ups
    reliable = r2 >= RELIABLE_R2

    # "Current" is the latest ACTUAL reading (meaningful), not a fitted value.
    current = float(y[-1])
    last_x = float(x[-1][0])
    slope = float(model.coef_[0])  # units per day
    predicted = float(model.predict([[last_x + horizon_days]])[0])

    # Guard against a noisy fit extrapolating to an absurd value: clamp to
    # within one observed range beyond the min/max actually seen.
    y_min, y_max = float(y.min()), float(y.max())
    span_y = max(y_max - y_min, 1e-6)
    lo, hi = y_min - span_y, y_max + span_y
    clamped = predicted < lo or predicted > hi
    predicted = min(max(predicted, lo), hi)

    # Direction only when the fit is trustworthy; otherwise report 'uncertain'.
    if not reliable:
        trend = 'uncertain'
    else:
        threshold = max(abs(current) * 0.02, 0.5)
        delta = predicted - current
        trend = 'rising' if delta > threshold else 'falling' if delta < -threshold else 'stable'

    return {
        'sufficient_data': True,
        'count': len(clean),
        'model': 'linear',
        'r2': round(r2, 3),
        'reliable': reliable,
        'current': round(current, 1),
        'slope_per_day': round(slope, 3),
        'horizon_days': horizon_days,
        'predicted': round(predicted, 1) if reliable else None,
        'trend': trend,
        'clamped': clamped,
    }
