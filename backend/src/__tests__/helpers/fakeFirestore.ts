import { Timestamp } from "firebase-admin/firestore";

type StoredDoc = Record<string, unknown>;

function clone<T>(value: T): T {
  if (Array.isArray(value)) {
    return [...value] as T;
  }

  if (value && typeof value === "object") {
    return { ...(value as Record<string, unknown>) } as T;
  }

  return value;
}

class FakeDocSnapshot {
  constructor(
    public readonly id: string,
    private readonly value: StoredDoc | undefined,
    public readonly ref: FakeDocumentReference,
  ) {}

  get exists() {
    return this.value !== undefined;
  }

  data() {
    return this.value ? clone(this.value) : undefined;
  }
}

class FakeQuerySnapshot {
  constructor(public readonly docs: FakeDocSnapshot[]) {}

  get empty() {
    return this.docs.length === 0;
  }

  get size() {
    return this.docs.length;
  }
}

class FakeBatch {
  private readonly ops: Array<() => void> = [];

  set(ref: FakeDocumentReference, data: Record<string, unknown>, options?: { merge?: boolean }) {
    this.ops.push(() => ref["db"].setDoc(ref.path, data, options?.merge ?? false));
    return this;
  }

  update(ref: FakeDocumentReference, patch: Record<string, unknown>) {
    this.ops.push(() => ref["db"].updateDoc(ref.path, patch));
    return this;
  }

  delete(ref: FakeDocumentReference) {
    this.ops.push(() => ref["db"].deleteDoc(ref.path));
    return this;
  }

  async commit() {
    for (const op of this.ops) {
      op();
    }
  }
}


class FakeTransaction {
  constructor(private readonly db: FakeFirestore) {}

  async get(ref: FakeDocumentReference) {
    return ref.get();
  }

  update(ref: FakeDocumentReference, patch: Record<string, unknown>) {
    this.db.updateDoc(ref.path, patch);
  }

  set(ref: FakeDocumentReference, data: Record<string, unknown>, options?: { merge?: boolean }) {
    this.db.setDoc(ref.path, data, options?.merge ?? false);
  }
}

class FakeQuery {
  constructor(
    private readonly db: FakeFirestore,
    private readonly docsProvider: () => Array<{ id: string; data: StoredDoc; ref: FakeDocumentReference }>,
    private readonly filters: Array<{ field: string; op: string; value: unknown }> = [],
    private readonly limitCount?: number,
  ) {}

  where(field: string, op: string, value: unknown) {
    return new FakeQuery(this.db, this.docsProvider, [...this.filters, { field, op, value }], this.limitCount);
  }

  limit(limit: number) {
    return new FakeQuery(this.db, this.docsProvider, this.filters, limit);
  }

  async get() {
    const docs = this.docsProvider()
      .filter(({ data }) =>
        this.filters.every((filter) => {
          const candidate = data[filter.field];
          if (filter.op === "==") return candidate === filter.value;
          if (filter.op === "<") return Number(candidate ?? 0) < Number(filter.value);
          return false;
        }),
      )
      .slice(0, this.limitCount ?? Number.MAX_SAFE_INTEGER)
      .map(({ id, data, ref }) => new FakeDocSnapshot(id, data, ref));

    return new FakeQuerySnapshot(docs);
  }
}

class FakeCollectionReference extends FakeQuery {
  constructor(
    private readonly dbRef: FakeFirestore,
    public readonly path: string,
  ) {
    super(
      dbRef,
      () => dbRef.listCollectionDocs(path).map(({ id, data }) => ({
        id,
        data,
        ref: new FakeDocumentReference(dbRef, `${path}/${id}`),
      })),
    );
  }

  doc(id?: string) {
    const docId = id ?? this.dbRef.autoId();
    return new FakeDocumentReference(this.dbRef, `${this.path}/${docId}`);
  }
}

class FakeDocumentReference {
  constructor(
    protected readonly db: FakeFirestore,
    public readonly path: string,
  ) {}

  get id() {
    return this.path.split("/").at(-1) ?? "";
  }

  collection(name: string) {
    return new FakeCollectionReference(this.db, `${this.path}/${name}`);
  }

  async get() {
    return new FakeDocSnapshot(this.id, this.db.getDoc(this.path), this);
  }

  async set(data: Record<string, unknown>, options?: { merge?: boolean }) {
    this.db.setDoc(this.path, data, options?.merge ?? false);
  }

  async update(patch: Record<string, unknown>) {
    this.db.updateDoc(this.path, patch);
  }

  async delete() {
    this.db.deleteDoc(this.path);
  }
}

export class FakeFirestore {
  private readonly store = new Map<string, StoredDoc>();
  private autoCounter = 0;

  collection(name: string) {
    return new FakeCollectionReference(this, name);
  }

  collectionGroup(collectionName: string) {
    return new FakeQuery(this, () =>
      Array.from(this.store.entries())
        .filter(([path]) => path.split("/").slice(-2, -1)[0] === collectionName)
        .map(([path, data]) => ({
          id: path.split("/").at(-1) ?? "",
          data,
          ref: new FakeDocumentReference(this, path),
        })),
    );
  }

  batch() {
    return new FakeBatch();
  }

  async runTransaction<T>(handler: (transaction: FakeTransaction) => Promise<T>) {
    return handler(new FakeTransaction(this));
  }

  autoId() {
    this.autoCounter += 1;
    return `auto_${this.autoCounter}`;
  }

  seed(path: string, data: Record<string, unknown>) {
    this.store.set(path, clone(data));
  }

  read(path: string) {
    const value = this.store.get(path);
    return value ? clone(value) : undefined;
  }

  listPaths(prefix: string) {
    return Array.from(this.store.entries())
      .filter(([path]) => path.startsWith(prefix))
      .map(([path, data]) => ({ path, data: clone(data) }));
  }

  getDoc(path: string) {
    const value = this.store.get(path);
    return value ? clone(value) : undefined;
  }

  setDoc(path: string, data: Record<string, unknown>, merge: boolean) {
    const existing = this.store.get(path);
    const next = merge && existing ? { ...existing, ...clone(data) } : clone(data);
    this.store.set(path, this.normalizeTransforms(next));
  }

  updateDoc(path: string, patch: Record<string, unknown>) {
    const existing = this.store.get(path) ?? {};
    this.store.set(path, this.normalizeTransforms({ ...existing, ...clone(patch) }));
  }

  deleteDoc(path: string) {
    this.store.delete(path);
  }

  listCollectionDocs(path: string) {
    const prefix = `${path}/`;
    return Array.from(this.store.entries())
      .filter(([candidate]) => candidate.startsWith(prefix))
      .filter(([candidate]) => candidate.slice(prefix.length).split("/").length === 1)
      .map(([candidate, data]) => ({
        id: candidate.slice(prefix.length),
        data: clone(data),
      }));
  }

  private normalizeTransforms(value: StoredDoc) {
    const normalized: StoredDoc = {};

    for (const [key, entry] of Object.entries(value)) {
      const ctorName = entry && typeof entry === "object" ? entry.constructor?.name : null;

      if (ctorName === "DeleteTransform") {
        continue;
      }

      if (ctorName === "ServerTimestampTransform") {
        normalized[key] = Timestamp.now();
        continue;
      }

      normalized[key] = entry;
    }

    return normalized;
  }
}
