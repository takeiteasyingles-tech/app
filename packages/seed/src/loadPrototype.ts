// Prototype data loader: the same node:vm sandbox the shared parity tests use (one implementation,
// so the seed and the tests can never disagree about what the prototype contains). Read-only.
import { type Any, extractConst, loadPrototypeData, PROTO_DIR } from '../../shared/test/helpers/prototype';

export { type Any, extractConst, PROTO_DIR };

/** TIE.data after running js/data/{curriculum,onboarding,extras,maggie,mic-clips,assistants}.js. */
export function loadPrototype(): Any {
  const T = loadPrototypeData();
  if (!T?.data?.EPS || !T.data.TITLES) throw new Error('prototype data did not load (TIE.data.EPS missing)');
  return T.data;
}
