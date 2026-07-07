/**
 * Note routes (API_CONTRACT §2 — 筆記; polymorphic entityType+entityId).
 *   GET    /notes?entityType=&entityId=   → Note[]
 *   POST   /notes {entityType, entityId, body, noteType?, pinned?} → 201 Note
 *   PATCH  /notes/:id  {...partial}        → Note
 *   DELETE /notes/:id                      → 204
 */
import type { Router } from "express";
import type { CrmCore } from "@meetcopilot/crm";
import type { Note, NewNote, NoteEntityType, NoteType } from "@meetcopilot/shared";
import { asyncHandler, orgId, userId, str, notFound, badRequest, sanitize, isOneOf, param } from "./helpers.js";

const NOTE_ENTITY_TYPES: readonly NoteEntityType[] = ["company", "contact", "deal", "meeting"];
const NOTE_TYPES: readonly NoteType[] = ["general", "call", "email", "research"];

export function registerNoteRoutes(router: Router, core: CrmCore): void {
  router.get(
    "/notes",
    asyncHandler(async (req, res) => {
      const entityType = req.query.entityType;
      const entityId = str(req.query.entityId);
      if (!isOneOf(entityType, NOTE_ENTITY_TYPES)) {
        badRequest(res, "entityType must be one of: " + NOTE_ENTITY_TYPES.join(", "));
        return;
      }
      if (!entityId) {
        badRequest(res, "entityId is required");
        return;
      }
      res.json(await core.notes.list(orgId(req), entityType, entityId));
    }),
  );

  router.post(
    "/notes",
    asyncHandler(async (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const entityType = body.entityType;
      const entityId = str(body.entityId);
      const noteBody = str(body.body);
      if (!isOneOf(entityType, NOTE_ENTITY_TYPES)) {
        badRequest(res, "entityType must be one of: " + NOTE_ENTITY_TYPES.join(", "));
        return;
      }
      if (!entityId) {
        badRequest(res, "entityId is required");
        return;
      }
      if (!noteBody) {
        badRequest(res, "body is required");
        return;
      }
      const noteType = body.noteType;
      const input: NewNote = {
        entityType,
        entityId,
        body: noteBody,
        authorUserId: userId(req),
        noteType: isOneOf(noteType, NOTE_TYPES) ? noteType : undefined,
        pinned: body.pinned === 1 || body.pinned === true ? 1 : undefined,
      };
      const note = await core.notes.create(orgId(req), input);
      res.status(201).json(note);
    }),
  );

  router.patch(
    "/notes/:id",
    asyncHandler(async (req, res) => {
      const patch = sanitize<Note>(req.body, ["entityType", "entityId", "authorUserId"]);
      const note = await core.notes.update(orgId(req), param(req, "id"), patch);
      res.json(note);
    }),
  );

  router.delete(
    "/notes/:id",
    asyncHandler(async (req, res) => {
      await core.notes.delete(orgId(req), param(req, "id"));
      res.status(204).end();
    }),
  );
}
