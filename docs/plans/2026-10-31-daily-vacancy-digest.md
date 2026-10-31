# Daily Vacancy Digest Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Send a complete list of currently matching UR vacancies to Telegram every day at 08:30 JST without affecting incremental notification state.

**Architecture:** Add a digest execution mode that performs the same live fetch and filters but sends every current result under a digest heading and exits without reading or writing `data/state.json`. A separate GitHub Actions workflow owns the daily schedule so it cannot be confused with the five-minute incremental monitor.

**Tech Stack:** Python 3.12 standard library, `unittest`, GitHub Actions, Telegram Bot API.

---

### Task 1: Add digest message generation

**Files:**
- Modify: `src/ur_monitor.py`
- Modify: `tests/test_ur_monitor.py`

1. Test non-empty and empty digest headings.
2. Refactor chunk generation to accept a custom heading.
3. Verify all tests pass.

### Task 2: Add state-independent digest mode

**Files:**
- Modify: `src/ur_monitor.py`
- Modify: `tests/test_ur_monitor.py`

1. Test that digest mode sends current rooms and never loads or saves incremental state.
2. Add the `--digest` command-line flag.
3. Verify all tests pass.

### Task 3: Schedule and deploy

**Files:**
- Create: `.github/workflows/daily-digest.yml`
- Modify: `README.md`

1. Schedule the digest for 08:30 in `Asia/Tokyo` and support manual dispatch.
2. Document daily behavior and empty-result messaging.
3. Commit, push, manually run, and verify the workflow.

