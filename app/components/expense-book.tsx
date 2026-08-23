"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

type Expense = {
  id: number;
  created_at: string;
  date: string;
  amount: number;
  description: string;
};

function todayLocal() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatAmount(amount: number) {
  return amount.toLocaleString("ko-KR");
}

function formatDate(date: string) {
  const [year, month, day] = date.split("-");
  if (!year || !month || !day) return date;
  return `${year}. ${Number(month)}. ${Number(day)}.`;
}

function formatSupabaseError(
  error: { code?: string; message?: string } | null,
  action: "load" | "save" | "delete",
) {
  if (error?.code === "42501") {
    return "데이터베이스 보안 정책 때문에 저장되지 않았습니다. Supabase SQL Editor에서 접근 정책을 추가해 주세요.";
  }

  if (action === "load") {
    return "지출 내역을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.";
  }
  if (action === "delete") {
    return "삭제에 실패했습니다. 잠시 후 다시 시도해 주세요.";
  }
  return "저장에 실패했습니다. 잠시 후 다시 시도해 주세요.";
}

export default function ExpenseBook() {
  const [date, setDate] = useState("");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    setDate(todayLocal());
    void loadExpenses();
  }, []);

  async function loadExpenses() {
    setReady(false);
    const { data, error } = await supabase
      .from("expenses")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      setErrorMessage(formatSupabaseError(error, "load"));
      setExpenses([]);
    } else {
      setErrorMessage("");
      setExpenses(data ?? []);
    }

    setReady(true);
  }

  const total = useMemo(
    () => expenses.reduce((sum, item) => sum + item.amount, 0),
    [expenses],
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const parsedAmount = Number(amount.replaceAll(",", ""));
    if (!date || !description.trim() || !Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      return;
    }

    setSaving(true);
    setErrorMessage("");

    const { data, error } = await supabase
      .from("expenses")
      .insert({
        date,
        amount: Math.round(parsedAmount),
        description: description.trim(),
      })
      .select()
      .single();

    setSaving(false);

    if (error || !data) {
      setErrorMessage(formatSupabaseError(error, "save"));
      return;
    }

    setExpenses((prev) => [data, ...prev]);
    setAmount("");
    setDescription("");
    setDate(todayLocal());
  }

  async function removeExpense(id: number) {
    const { error } = await supabase.from("expenses").delete().eq("id", id);
    if (error) {
      setErrorMessage(formatSupabaseError(error, "delete"));
      return;
    }

    setExpenses((prev) => prev.filter((item) => item.id !== id));
  }

  return (
    <div className="flex min-h-dvh flex-1 flex-col bg-[radial-gradient(ellipse_at_top,_#ecfdf5_0%,_#f8fafc_45%,_#eef2ff_100%)]">
      <header className="px-4 pt-10 pb-6 text-center sm:px-6 sm:pt-16">
        <p className="mb-3 text-base font-medium tracking-wide text-emerald-700 sm:text-sm">
          ACCOUNT BOOK
        </p>
        <h1 className="text-4xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
          나의 AI 가계부
        </h1>
        <p className="mt-3 text-base leading-relaxed text-slate-500 sm:text-base">
          날짜, 금액, 내용을 기록하고 지출을 한눈에 확인하세요.
        </p>
      </header>

      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col px-4 pb-[max(5rem,env(safe-area-inset-bottom))] sm:px-6">
        <form
          onSubmit={handleSubmit}
          className="w-full rounded-3xl border border-white/80 bg-white/80 p-5 shadow-[0_20px_50px_-24px_rgba(15,23,42,0.35)] backdrop-blur-sm sm:p-8"
        >
          <div className="grid grid-cols-1 gap-7 sm:grid-cols-2 sm:gap-5">
            <label className="flex min-w-0 flex-col gap-3 text-base font-medium text-slate-700 sm:gap-2 sm:text-sm">
              날짜
              <input
                type="date"
                required
                value={date}
                onChange={(event) => setDate(event.target.value)}
                className="h-14 w-full min-w-0 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-lg font-normal text-slate-900 outline-none transition focus:border-emerald-500 focus:bg-white focus:ring-4 focus:ring-emerald-500/15 sm:h-12 sm:text-base"
              />
            </label>

            <label className="flex min-w-0 flex-col gap-3 text-base font-medium text-slate-700 sm:gap-2 sm:text-sm">
              금액
              <input
                type="number"
                required
                min="1"
                step="1"
                inputMode="numeric"
                placeholder="0"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                className="h-14 w-full min-w-0 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-lg font-normal text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-500 focus:bg-white focus:ring-4 focus:ring-emerald-500/15 sm:h-12 sm:text-base"
              />
            </label>
          </div>

          <label className="mt-7 flex min-w-0 flex-col gap-3 text-base font-medium text-slate-700 sm:mt-5 sm:gap-2 sm:text-sm">
            내용
            <input
              type="text"
              required
              maxLength={80}
              placeholder="예: 점심 식사, 교통비"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              className="h-14 w-full min-w-0 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-lg font-normal text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-500 focus:bg-white focus:ring-4 focus:ring-emerald-500/15 sm:h-12 sm:text-base"
            />
          </label>

          {errorMessage ? (
            <p className="mt-5 text-base leading-relaxed text-rose-600 sm:mt-4 sm:text-sm">
              {errorMessage}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={saving}
            className="mt-7 h-14 w-full rounded-2xl bg-emerald-600 text-lg font-semibold text-white shadow-lg shadow-emerald-600/20 transition hover:bg-emerald-700 focus:outline-none focus:ring-4 focus:ring-emerald-500/25 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60 sm:mt-6 sm:h-12 sm:text-base"
          >
            {saving ? "저장 중..." : "저장하기"}
          </button>
        </form>

        <section className="mt-10 w-full sm:mt-8">
          <div className="mb-5 flex items-end justify-between gap-4 sm:mb-4">
            <h2 className="text-xl font-semibold text-slate-900 sm:text-lg">
              지출 내역
            </h2>
            <p className="text-base text-slate-500 sm:text-sm">
              합계{" "}
              <span className="font-semibold text-slate-900">
                {formatAmount(total)}원
              </span>
            </p>
          </div>

          {!ready ? (
            <div className="rounded-2xl border border-slate-200/80 bg-white/60 px-5 py-12 text-center text-base text-slate-400 sm:py-10 sm:text-sm">
              내역을 불러오는 중...
            </div>
          ) : expenses.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white/50 px-5 py-12 text-center text-base text-slate-400 sm:py-10 sm:text-sm">
              아직 저장된 지출이 없습니다.
            </div>
          ) : (
            <ul className="space-y-4 sm:space-y-3">
              {expenses.map((item) => (
                <li
                  key={item.id}
                  className="flex flex-col gap-3 rounded-2xl border border-white/80 bg-white/75 px-5 py-5 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:py-4"
                >
                  <div className="min-w-0">
                    <p className="break-words text-lg font-medium text-slate-900 sm:truncate sm:text-base">
                      {item.description}
                    </p>
                    <p className="mt-1 text-base text-slate-500 sm:text-sm">
                      {formatDate(item.date)}
                    </p>
                  </div>
                  <div className="flex items-center justify-between gap-3 sm:justify-end">
                    <p className="shrink-0 text-lg font-semibold tabular-nums text-slate-900 sm:text-base">
                      {formatAmount(item.amount)}원
                    </p>
                    <button
                      type="button"
                      onClick={() => void removeExpense(item.id)}
                      className="inline-flex h-11 min-w-11 items-center justify-center rounded-xl px-4 text-base text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 sm:h-auto sm:min-w-0 sm:px-2 sm:py-1 sm:text-xs sm:text-slate-400"
                      aria-label={`${item.description} 삭제`}
                    >
                      삭제
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
