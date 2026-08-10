export type L1ReadController = {
  run<T>(
    read: () => Promise<T>,
    commit: (value: T) => void,
    reject?: (error: unknown) => void,
    finish?: () => void,
  ): number;
  invalidate(): void;
};

export function createL1ReadController(): L1ReadController {
  let current = 0;
  return {
    run: (read, commit, reject, finish) => {
      const generation = ++current;
      void Promise.resolve()
        .then(read)
        .then((value) => {
          if (generation === current) commit(value);
        })
        .catch((error) => {
          if (generation === current) reject?.(error);
        })
        .finally(() => {
          if (generation === current) finish?.();
        });
      return generation;
    },
    invalidate: () => { ++current; },
  };
}
