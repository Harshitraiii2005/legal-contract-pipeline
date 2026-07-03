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
    if (!contractId) return;

    selectContract(contractId);
    fetchAudit(contractId);

    let intervalId: any = null;

    const shouldPoll =
      currentContract &&
      (currentContract.status === "processing" || currentContract.status === "pending");

    if (shouldPoll) {
      intervalId = setInterval(() => {
        selectContract(contractId);
        fetchAudit(contractId);
      }, 3000);
    }

    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [contractId, currentContract?.status]);

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
