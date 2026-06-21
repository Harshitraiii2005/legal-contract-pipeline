import { useEffect } from "react";
import { useReviewStore } from "../store/reviewStore";

export function useReview(contractId?: string) {
  const {
    currentContract,
    currentReview,
    auditEvents,
    loading,
    error,
    selectContract,
    submitApproval,
    fetchAudit,
    clearError,
  } = useReviewStore();

  useEffect(() => {
    if (contractId) {
      selectContract(contractId);
      fetchAudit(contractId);
    }
  }, [contractId]);

  const approve = (notes?: string) =>
    contractId ? submitApproval(contractId, true, notes) : Promise.resolve();

  const reject = (notes?: string) =>
    contractId ? submitApproval(contractId, false, notes) : Promise.resolve();

  return {
    contract: currentContract,
    review: currentReview,
    auditEvents,
    loading,
    error,
    approve,
    reject,
    clearError,
  };
}
