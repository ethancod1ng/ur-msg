# Kayabacho Commute Filter Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Notify only Tokyo UR rooms under 100,000 yen whose conservative commute to Kayabacho is no more than 60 minutes, using a compact personalized Telegram format.

**Architecture:** Load UR's official Kayabacho travel-time XML once per run, map property access stations to rail time and transfers, and add the maximum advertised walk/bus time. Store the estimate with each vacancy so filtering, state snapshots, dry-run output, and Telegram formatting use the same evidence.

**Tech Stack:** Python 3.12 standard library, UR JSON/XML endpoints, `unittest`, GitHub Actions, Telegram Bot API.

---

### Task 1: Parse conservative commute estimates

**Files:**
- Modify: `src/ur_monitor.py`
- Modify: `tests/test_ur_monitor.py`

1. Add tests for UR XML parsing, station-name normalization, walk-only access, and bus-plus-walk access.
2. Implement route loading and conservative access parsing.
3. Run `python -m unittest discover -s tests -v` and verify the tests pass.

### Task 2: Apply the commute filter

**Files:**
- Modify: `src/ur_monitor.py`
- Modify: `tests/test_ur_monitor.py`

1. Test the 60-minute boundary and unknown-route exclusion.
2. Attach commute estimates during vacancy discovery and apply the default limit.
3. Run a live fetch and verify every result is at or below 60 minutes and 100,000 yen.

### Task 3: Personalize Telegram messages and deploy

**Files:**
- Modify: `src/ur_monitor.py`
- Modify: `tests/test_ur_monitor.py`
- Modify: `README.md`
- Modify: `.github/workflows/monitor.yml`

1. Test a compact message containing total housing cost, Kayabacho commute, transfers, station access, layout, and match reason.
2. Update documentation and workflow defaults.
3. Commit, push, run GitHub Actions, and verify the updated baseline.

