# Loggkontroll — Systematic Log Review Procedure

**Document owner:** Data Protection Officer (DPO)
**Applies to:** Vidacure AB — all systems processing patient data
**Version:** 1.0
**Last reviewed:** 2026-05-29
**Review cycle:** Annually, or on material system change

---

## 1. Purpose & legal basis

This procedure defines how Vidacure systematically and recurrently reviews access logs to
patient data in order to detect and respond to unauthorized access.

It implements:
- **Patientdatalagen (2008:355) Ch. 4 §3** — access to patient data must be documented *and systematically controlled*.
- **HSLF-FS 2016:40 Ch. 4 §§9–9b** (Socialstyrelsen) — the log-control duty and the requirement that reviews be documented.
- **GDPR Art. 32** — appropriate technical and organisational security measures.

Logging access alone does not satisfy the law; the logs must be *reviewed* and each review *recorded*.

## 2. Roles & responsibility

| Role | Responsibility |
|---|---|
| **DPO** | Owns this procedure; performs/oversees reviews; decides escalation; reports breaches to IMY. |
| **Admin/superadmin reviewer** | Conducts the routine review using the admin Log Reviews tool; records outcome and notes. |
| **Verksamhetschef / management** | Receives escalations; authorises disciplinary/HR follow-up. |

The care provider (Vidacure AB) bears overall responsibility for ensuring reviews occur.

## 3. Frequency

- **Routine review:** monthly (covering the preceding period).
- **Ad-hoc review:** without delay upon any suspicion of unauthorized access, or on a patient complaint.

The chosen cadence must be one the organisation can realistically sustain; document any change here.

## 4. Scope — parameters reviewed

Each routine review samples access logs on a risk basis. The admin **Audit Logs → Anomaly Scan**
surfaces these parameters; the reviewer assesses each:

| Parameter | What it flags | Status in tooling |
|---|---|---|
| High-volume access | One staff member accessing many distinct patients | ✅ Automated card |
| Failed access clusters | Repeated failed access attempts | ✅ Automated card |
| After-hours access | Staff access outside 07:00–19:00 CET | ✅ Automated card (patients excluded) |
| Single-patient frequency | One staff member repeatedly accessing one patient | ✅ Automated card |
| Protected/sensitive identity | Access to protected-identity patients | ⚠️ Manual until automated |
| Cross-unit / cross-process access | Access outside the staff member's unit/role | ⚠️ Manual until automated |
| Forced overrides (nödöppning) | Emergency "break-glass" access | ⚠️ Not applicable until feature exists |

## 5. What counts as unauthorized access

Access is unauthorized when a staff member opens a patient's data **without a current care
relationship or work-related need**. Concrete examples:

- Accessing the record of a patient one is not treating (e.g. a neighbour, relative, public figure, ex-partner).
- Browsing records out of curiosity.
- Repeatedly accessing one patient with no corresponding care activity.
- Accessing data after a care relationship has ended, without a legitimate follow-up reason.

Legitimate access (NOT a violation):
- Access for the staff member's own current patients / care tasks.
- A patient accessing their own data.
- A staff member accessing their own record.

## 6. How each review is documented

Every review — routine or ad-hoc — is recorded in the admin **Log Reviews** tool, capturing:

- Reviewer identity and timestamp (recorded automatically).
- Period covered and parameters reviewed.
- **Outcome:** `clean`, `flagged`, or `escalated`.
- Written assessment (notes), and the anomaly snapshot at review time.

Recording a review is itself written to the audit log (`admin_create_log_review`), so the act of
reviewing is traceable. Records are retained as compliance evidence (no automatic deletion).

## 7. Escalation & breach response

1. **Flagged** items are noted and monitored; resolve in the tool when assessed.
2. **Escalated** items (suspected unauthorized access) → notify the DPO immediately.
3. DPO investigates (interview, access context, care relationship check).
4. If a **personal-data breach** is confirmed, report to **IMY within 72 hours** (GDPR Art. 33),
   and inform affected patients where required (Art. 34).
5. Internal follow-up (HR/disciplinary) coordinated with management; resolution recorded in the tool.

## 8. Staff information

All staff are informed — at onboarding and in internal policy — that:
- Their access to patient data is logged.
- Logs are systematically reviewed.
- Unauthorized access is a disciplinary matter and may be a criminal offence (dataintrång, BrB 4:9c).

## 9. Revision history

| Version | Date | Author | Change |
|---|---|---|---|
| 1.0 | 2026-05-29 | DPO | Initial procedure. |