import { useAdminAuth } from "@/lib/store/admin-auth";

export function currentAdminOperator(fallback = "unknown-admin") {
  const state = useAdminAuth.getState();
  return state.session?.operator || state.session?.username || state.operator || fallback;
}
