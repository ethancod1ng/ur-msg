# UR Tokyo Telegram Monitor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Monitor all currently available UR rental rooms in Tokyo and notify a Telegram chat when a room newly appears.

**Architecture:** A dependency-free Python command queries UR's public JSON endpoints, normalizes room records, applies optional environment-variable filters, and compares the result with a committed JSON snapshot. A scheduled GitHub Actions workflow runs the command every 30 minutes and commits snapshot changes back to the repository.

**Tech Stack:** Python 3.12 standard library, `unittest`, GitHub Actions, Telegram Bot HTTP API.

---

### Task 1: Model vacancy discovery and filtering

**Files:**
- Create: `src/ur_monitor.py`
- Create: `tests/test_ur_monitor.py`

1. Write tests for rent parsing, room normalization, filters, and vacancy comparison.
2. Run `python -m unittest discover -s tests -v` and verify the tests fail before implementation.
3. Implement UR API requests, normalization, filters, and stable room keys.
4. Re-run the tests and verify they pass.

### Task 2: Add Telegram delivery and state handling

**Files:**
- Modify: `src/ur_monitor.py`
- Modify: `tests/test_ur_monitor.py`

1. Write tests for initial baseline behavior, newly appeared rooms, and Telegram-safe message formatting.
2. Implement atomic JSON state writes and chunked Telegram Bot API delivery.
3. Verify the entire test suite.

### Task 3: Automate with GitHub Actions

**Files:**
- Create: `.github/workflows/monitor.yml`
- Create: `.gitignore`
- Create: `README.md`

1. Add a 30-minute schedule plus manual dispatch.
2. Read Telegram credentials from repository secrets and commit changed state with minimal permissions.
3. Document bot setup, secrets, filters, first-run behavior, and local verification.
4. Run a live dry run against UR and verify vacancies are returned without sending Telegram messages.

