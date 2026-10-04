import { createContext, useContext, useEffect, useLayoutEffect, type DependencyList, type EffectCallback } from 'react';

/** Standalone Apps remain active. The Host owns suspension, never trading state. */
export const AppActivityContext = createContext(true);
export const useAppActive = () => useContext(AppActivityContext);

/** Opt-in App effects clean up on suspension and reconnect on activation. */
export function useAppEffect(effect: EffectCallback, dependencies: DependencyList) {
  const active = useAppActive();
  useEffect(() => active ? effect() : undefined, [active, ...dependencies]);
}

export function useAppLayoutEffect(effect: EffectCallback, dependencies: DependencyList) {
  const active = useAppActive();
  useLayoutEffect(() => active ? effect() : undefined, [active, ...dependencies]);
}
