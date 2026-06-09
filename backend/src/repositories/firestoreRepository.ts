import type {
  CollectionReference,
  DocumentData,
  Firestore,
  QueryDocumentSnapshot,
} from "firebase-admin/firestore";
import type { ZodType } from "zod";

import { ApiError } from "../utils/apiError.js";

export function snapshotToData<T>(
  snapshot: QueryDocumentSnapshot<DocumentData>,
  schema: ZodType<T>,
): T {
  return schema.parse({
    id: snapshot.id,
    ...snapshot.data(),
  });
}

export function workspaceCollection(
  db: Firestore,
  workspaceId: string,
  collectionName: string,
): CollectionReference<DocumentData> {
  if (!workspaceId) {
    throw new ApiError({
      code: "VALIDATION_ERROR",
      message: "workspaceId is required for workspace-scoped repositories.",
      status: 400,
    });
  }

  return db.collection("workspaces").doc(workspaceId).collection(collectionName);
}

export function assertWorkspaceScoped(data: { workspaceId: string }, workspaceId: string) {
  if (data.workspaceId !== workspaceId) {
    throw new ApiError({
      code: "VALIDATION_ERROR",
      message: "Document workspaceId does not match the requested workspace.",
      status: 400,
    });
  }
}
