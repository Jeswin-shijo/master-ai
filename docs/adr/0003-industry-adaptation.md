# 0003. The platform adapts to the owner's industry at signup

Date: 2026-10-12 · Status: accepted

## Context
The plan's open decision was "pilot industry: travel agency or education?". The owner chose instead: the system should adapt to whatever industry the business owner gives at signup.

## Decision
Onboarding turns the owner's free text into a pack draft the owner reviews before install:
1. **Match** a curated industry pack in the registry (keyword and phrase scoring; `travel-agency` today).
2. Otherwise **generate**. With a model, the LLM gateway designs a pack on top of the base packs using structured outputs, validated by schema and cross-reference checks with one repair round. Without a model, the **offline composer** picks base packs by business family (bookings, orders, projects, education) and renames shared records for the sector, e.g. Customer → Patient, Booking → Appointment.
3. **Install** snapshots the resolved pack into a workspace, creates an agent principal per role, and writes policy set v1.

Industry-specific tools are aliases over generic primitives (`booking.confirm` = `records.update` with `status: confirmed`), so new sectors never need new code.

## Consequences
Any industry gets a working setup on day one. Curated packs remain the quality bar for verticals worth investing in.
