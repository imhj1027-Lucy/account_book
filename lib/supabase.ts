import { createClient } from "@supabase/supabase-js";

export type Expense = {
  id: number;
  created_at: string;
  date: string;
  amount: number;
  description: string;
};

export type ExpenseInsert = {
  date: string;
  amount: number;
  description: string;
};

export type Database = {
  public: {
    Tables: {
      expenses: {
        Row: Expense;
        Insert: ExpenseInsert;
        Update: Partial<ExpenseInsert>;
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    "Supabase 환경 변수가 없습니다. 프로젝트 루트 .env.local에 NEXT_PUBLIC_SUPABASE_URL과 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY를 설정하세요.",
  );
}

export const supabase = createClient<Database>(supabaseUrl, supabaseKey);
