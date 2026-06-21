import { create } from "zustand";
import { Contract, Review, AuditEvent, contractsApi, reviewsApi } from "../api/client";

interface ReviewStore {
  contracts: Contract[];
  currentContract: Contract | null;
  currentReview: Review | null;
  auditEvents: AuditEvent[];
  loading: boolean;
  error: string | null;

  fetchContracts: () => Promise<void>;
  uploadContract: (file: File) => Promise<Contract>;
  selectContract: (id: string) => Promise<void>;
  submitApproval: (contractId: string, approved: boolean, notes?: string) => Promise<void>;
  fetchAudit: (contractId: string) => Promise<void>;
  clearError: () => void;
}

export const useReviewStore = create<ReviewStore>((set, get) => ({
  contracts: [],
  currentContract: null,
  currentReview: null,
  auditEvents: [],
  loading: false,
  error: null,

  fetchContracts: async () => {
    set({ loading: true, error: null });
    try {
      const { data } = await contractsApi.list();
      set({ contracts: data, loading: false });
    } catch (e: any) {
      set({ error: e.message, loading: false });
    }
  },

  uploadContract: async (file: File) => {
    set({ loading: true, error: null });
    try {
      const { data } = await contractsApi.upload(file);
      set((s) => ({ contracts: [data, ...s.contracts], loading: false }));
      return data;
    } catch (e: any) {
      set({ error: e.response?.data?.detail ?? e.message, loading: false });
      throw e;
    }
  },

  selectContract: async (id: string) => {
    set({ loading: true, error: null });
    try {
      const [contractRes, reviewRes] = await Promise.allSettled([
        contractsApi.get(id),
        reviewsApi.get(id),
      ]);

      const contract = contractRes.status === "fulfilled" ? contractRes.value.data : null;
      const review = reviewRes.status === "fulfilled" ? reviewRes.value.data : null;

      set({ currentContract: contract, currentReview: review, loading: false });
    } catch (e: any) {
      set({ error: e.message, loading: false });
    }
  },

  submitApproval: async (contractId, approved, notes = "") => {
    set({ loading: true, error: null });
    try {
      await reviewsApi.approve(contractId, approved, notes);
      // Refresh
      await get().selectContract(contractId);
      await get().fetchContracts();
    } catch (e: any) {
      set({ error: e.response?.data?.detail ?? e.message, loading: false });
      throw e;
    }
  },

  fetchAudit: async (contractId: string) => {
    try {
      const { data } = await reviewsApi.audit(contractId);
      set({ auditEvents: data });
    } catch (e: any) {
      set({ error: e.message });
    }
  },

  clearError: () => set({ error: null }),
}));
