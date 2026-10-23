// useIdentity: react-query hooks over identityService, mirroring
// the useP2p.ts pattern (own status is money-adjacent identity
// state, so it is read with staleTime 0 where a decision matters).

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import {
  fetchIdentityReviewQueue,
  fetchMyIdentityStatus,
} from "@/services/identityService";

export const identityKeys = {
  status: ["identity", "status"] as const,
  adminQueue: ["identity", "admin-queue"] as const,
};

export function useMyIdentityStatus() {
  const { user } = useAuth();
  return useQuery({
    queryKey: identityKeys.status,
    queryFn: fetchMyIdentityStatus,
    enabled: !!user,
    staleTime: 0,
  });
}

export function useIdentityReviewQueue(enabled = true) {
  return useQuery({
    queryKey: identityKeys.adminQueue,
    queryFn: fetchIdentityReviewQueue,
    enabled,
    staleTime: 0,
    refetchInterval: 30_000,
  });
}

export function useInvalidateIdentity() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: identityKeys.status });
    void qc.invalidateQueries({ queryKey: identityKeys.adminQueue });
  };
}
