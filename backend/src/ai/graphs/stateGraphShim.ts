/**
 * Minimal local replacement for the subset of @langchain/langgraph that the
 * command pipeline uses: Annotation / Annotation.Root, StateGraph (addNode,
 * addEdge, compile), START/END, and a linear `invoke` with last-write-wins merge.
 *
 * The command graph is strictly linear (parseInput → ... → output) and uses no
 * custom channel reducers, so LangGraph's default "overwrite" merge is exactly
 * `state = { ...state, ...partial }`. This shim replicates that behavior with no
 * external dependency, preserving the `typeof CommandState.State` type for
 * downstream consumers.
 */

export const START = "__start__" as const;
export const END = "__end__" as const;

/** Marker returned by Annotation<T>(); carries T for state-type inference. */
export type AnnotationField<T> = { readonly __type: T };

type StateFromSpec<Spec> = {
  [K in keyof Spec]: Spec[K] extends AnnotationField<infer T> ? T : unknown;
};

export interface AnnotationRoot<Spec> {
  readonly spec: Spec;
  /** Type carrier only: `typeof X.State` yields the inferred state shape. */
  readonly State: StateFromSpec<Spec>;
}

type AnnotationFn = {
  <T>(): AnnotationField<T>;
  Root<Spec extends Record<string, AnnotationField<unknown>>>(spec: Spec): AnnotationRoot<Spec>;
};

const annotationImpl = <T>(): AnnotationField<T> => ({ __type: undefined as unknown as T });
(annotationImpl as AnnotationFn).Root = <Spec extends Record<string, AnnotationField<unknown>>>(
  spec: Spec,
): AnnotationRoot<Spec> => ({ spec, State: {} as StateFromSpec<Spec> });

export const Annotation = annotationImpl as AnnotationFn;

// Return type is intentionally permissive (like LangGraph's addNode): nodes
// return a partial state update; the runner merges it last-write-wins.
type NodeFn<S> = (state: S) => unknown;

class CompiledStateGraph<S extends Record<string, unknown>> {
  constructor(
    private readonly nodes: Map<string, NodeFn<S>>,
    private readonly edges: Map<string, string>,
  ) {}

  async invoke(input: Partial<S>): Promise<S> {
    let state = { ...input } as S;
    let next = this.edges.get(START);
    const visited = new Set<string>();
    while (next && next !== END) {
      if (visited.has(next)) {
        throw new Error(`stateGraphShim: unexpected cycle at node "${next}" (graph must be linear)`);
      }
      visited.add(next);
      const node = this.nodes.get(next);
      if (!node) {
        throw new Error(`stateGraphShim: no node registered for "${next}"`);
      }
      const partial = (await node(state)) as Partial<S> | null | undefined;
      if (partial) state = { ...state, ...partial };
      next = this.edges.get(next);
    }
    return state;
  }
}

export class StateGraph<S extends Record<string, unknown>> {
  private readonly nodes = new Map<string, NodeFn<S>>();
  private readonly edges = new Map<string, string>();

  // The state definition is used only for type inference (S).
  constructor(_stateDefinition?: { State: S }) {}

  addNode(name: string, fn: NodeFn<S>): this {
    this.nodes.set(name, fn);
    return this;
  }

  addEdge(from: string, to: string): this {
    this.edges.set(from, to);
    return this;
  }

  compile(): CompiledStateGraph<S> {
    return new CompiledStateGraph(this.nodes, this.edges);
  }
}
