"""Periodic noise in numpy: every function tiles over [0, 1) in both axes, so the
ground tiles built from it repeat without a seam. Coordinates are in tile units."""

import numpy as np


def _fade(t):
    return t * t * t * (t * (t * 6 - 15) + 10)


def value(x, y, period, seed):
    """Smooth value noise in [0, 1] with `period` lattice cells per tile (integer)."""
    rng = np.random.default_rng(seed)
    g = rng.random((period, period))
    fx = np.asarray(x) * period
    fy = np.asarray(y) * period
    x0 = np.floor(fx).astype(np.int64)
    y0 = np.floor(fy).astype(np.int64)
    tx = _fade(fx - x0)
    ty = _fade(fy - y0)
    x0 %= period
    y0 %= period
    x1 = (x0 + 1) % period
    y1 = (y0 + 1) % period
    a = g[y0, x0] * (1 - tx) + g[y0, x1] * tx
    b = g[y1, x0] * (1 - tx) + g[y1, x1] * tx
    return a * (1 - ty) + b * ty


def fbm(x, y, period, seed, octaves=4, gain=0.5):
    """Fractal sum of value noise, normalized to about [0, 1]."""
    total = 0.0
    amp = 1.0
    norm = 0.0
    for o in range(octaves):
        total = total + amp * value(x, y, period * (2 ** o), seed + 101 * o)
        norm += amp
        amp *= gain
    return total / norm


def wave(x, freqs):
    """Sum of sines with integer frequencies (periodic): [(freq, amp, phase), ...]."""
    out = np.zeros_like(np.asarray(x, dtype=np.float64))
    for f, a, p in freqs:
        out = out + a * np.sin(2 * np.pi * f * x + p)
    return out


def smoothstep(e0, e1, v):
    t = np.clip((v - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def equalize(v):
    """Rank-normalize to a uniform [0, 1] distribution (predictable thresholds)."""
    flat = v.ravel()
    order = np.argsort(flat, kind="stable")
    ranks = np.empty_like(order)
    ranks[order] = np.arange(flat.size)
    return (ranks / (flat.size - 1)).reshape(v.shape)
