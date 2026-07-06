"""Dependency-free crop-recommendation model.

A small k-nearest-neighbours classifier written in pure Python — no numpy /
scikit-learn, so it runs anywhere Django does (including brand-new Python
builds with no ML wheels yet). Features are the soil reading [N, P, K, pH,
moisture]; the label is the crop that suits that soil.

`train()` z-score-normalises the features, stores the samples, and estimates
accuracy with leave-one-out cross-validation. `predict()` returns crops ranked
by a distance-weighted vote. The trained model is a plain dict, so it
serialises straight to JSON for persistence.
"""
import json
import math

FEATURES = ('n', 'p', 'k', 'ph', 'moisture')


def _standardize_params(rows):
    """Return (means, stds) per feature; std floored at 1 to avoid /0."""
    means, stds = [], []
    n = len(rows)
    for i in range(len(FEATURES)):
        vals = [r[i] for r in rows]
        m = sum(vals) / n
        var = sum((v - m) ** 2 for v in vals) / n
        s = math.sqrt(var)
        means.append(m)
        stds.append(s if s > 1e-9 else 1.0)
    return means, stds


def _norm(vec, means, stds):
    return [(vec[i] - means[i]) / stds[i] for i in range(len(FEATURES))]


def _knn_vote(train_rows, train_labels, x, k):
    """Distance-weighted KNN. Returns [(label, confidence), ...] desc."""
    dists = []
    for i, r in enumerate(train_rows):
        d = math.sqrt(sum((r[j] - x[j]) ** 2 for j in range(len(x))))
        dists.append((d, train_labels[i]))
    dists.sort(key=lambda t: t[0])
    top = dists[: min(k, len(dists))]
    scores = {}
    for d, lab in top:
        scores[lab] = scores.get(lab, 0.0) + 1.0 / (d + 1e-6)
    total = sum(scores.values()) or 1.0
    ranked = sorted(((lab, s / total) for lab, s in scores.items()),
                    key=lambda t: t[1], reverse=True)
    return ranked


def train(samples, k=5):
    """Train on samples (list of dicts with FEATURES + 'crop').

    Returns a JSON-serialisable model dict including a leave-one-out accuracy
    estimate, or raises ValueError if there is not enough data.
    """
    if len(samples) < 2:
        raise ValueError('need at least 2 samples to train')
    classes = sorted({s['crop'] for s in samples})
    if len(classes) < 2:
        raise ValueError('need at least 2 different crops to train')

    rows = [[float(s[f]) for f in FEATURES] for s in samples]
    labels = [s['crop'] for s in samples]
    means, stds = _standardize_params(rows)
    nrows = [_norm(r, means, stds) for r in rows]

    n = len(nrows)
    k_eff = max(1, min(k, n - 1))
    correct = 0
    for i in range(n):
        tr = [nrows[j] for j in range(n) if j != i]
        tl = [labels[j] for j in range(n) if j != i]
        pred = _knn_vote(tr, tl, nrows[i], k_eff)[0][0]
        if pred == labels[i]:
            correct += 1
    accuracy = correct / n

    per_crop = {c: labels.count(c) for c in classes}
    return {
        'k': k_eff,
        'means': means,
        'stds': stds,
        'rows': nrows,
        'labels': labels,
        'features': list(FEATURES),
        'classes': classes,
        'per_crop': per_crop,
        'n': n,
        'accuracy': accuracy,
    }


def predict(model, feat, top=3):
    """Rank crops for a soil reading dict. Returns [(crop, confidence), ...]."""
    x = _norm([float(feat.get(f, 0) or 0) for f in model['features']],
              model['means'], model['stds'])
    ranked = _knn_vote(model['rows'], model['labels'], x, model['k'])
    return ranked[:top]


def save(model, path):
    with open(path, 'w', encoding='utf-8') as fh:
        json.dump(model, fh)


def load(path):
    try:
        with open(path, encoding='utf-8') as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return None
