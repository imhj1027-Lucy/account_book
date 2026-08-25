"use client";

import {
  FormEvent,
  KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { supabase, type Expense } from "@/lib/supabase";

type ChatRole = "user" | "ai";

type ChatMessage = {
  id: string;
  role: ChatRole;
  text: string;
};

const WELCOME_MESSAGE =
  "안녕하세요! 오늘 쓴 돈을 편하게 말씀해 주세요.\n예: 점심 8,000원 / 어제 택시비 12,000원\n이번 달 총 지출이 얼마야? 처럼 물어보셔도 돼요.";

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
  action: "load" | "delete",
) {
  if (error?.code === "42501") {
    return "데이터베이스 보안 정책 때문에 불러오지 못했습니다.";
  }
  if (action === "delete") {
    return "삭제에 실패했습니다. 잠시 후 다시 시도해 주세요.";
  }
  return "지출 내역을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.";
}

function createMessage(role: ChatRole, text: string): ChatMessage {
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return { id, role, text };
}

export default function ExpenseBook() {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [ready, setReady] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([
    createMessage("ai", WELCOME_MESSAGE),
  ]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    void loadExpenses();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

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

  async function removeExpense(id: number) {
    const { error } = await supabase.from("expenses").delete().eq("id", id);
    if (error) {
      setErrorMessage(formatSupabaseError(error, "delete"));
      return;
    }

    setExpenses((prev) => prev.filter((item) => item.id !== id));
  }

  async function sendMessage() {
    const text = input.trim();
    if (!text || sending) return;

    const nextMessages = [...messages, createMessage("user", text)];
    setMessages(nextMessages);
    setInput("");
    setSending(true);
    setErrorMessage("");

    const history = nextMessages
      .filter((item) => item.text !== WELCOME_MESSAGE)
      .slice(-12)
      .map((item) => ({
        role: item.role === "user" ? ("user" as const) : ("model" as const),
        text: item.text,
      }));

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          history: history.slice(0, -1),
        }),
      });

      const payload = (await response.json()) as {
        reply?: string;
        expenses?: Expense[];
        error?: string;
      };

      if (!response.ok || !payload.reply) {
        setMessages((prev) => [
          ...prev,
          createMessage(
            "ai",
            payload.error ?? "응답을 받지 못했어요. 잠시 후 다시 시도해 주세요.",
          ),
        ]);
        return;
      }

      if (payload.expenses?.length) {
        setExpenses((prev) => [...payload.expenses!, ...prev]);
      }

      setMessages((prev) => [...prev, createMessage("ai", payload.reply!)]);
    } catch {
      setMessages((prev) => [
        ...prev,
        createMessage("ai", "연결에 실패했어요. 잠시 후 다시 시도해 주세요."),
      ]);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendMessage();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void sendMessage();
    }
  }

  return (
    <div className="flex min-h-dvh flex-1 flex-col bg-[#b9cadb]">
      <header className="sticky top-0 z-10 border-b border-black/5 bg-white/95 px-4 py-3.5 text-center backdrop-blur-sm">
        <h1 className="text-[17px] font-semibold tracking-tight text-slate-900">
          AI 가계부 챗봇
        </h1>
      </header>

      <section className="border-b border-black/5 bg-white/80 px-4 py-3">
        <div className="mb-2 flex items-end justify-between gap-3">
          <h2 className="text-sm font-semibold text-slate-800">저장된 지출</h2>
          <p className="text-xs text-slate-500">
            합계{" "}
            <span className="font-semibold tabular-nums text-slate-800">
              {formatAmount(total)}원
            </span>
          </p>
        </div>

        {errorMessage ? (
          <p className="mb-2 text-xs leading-relaxed text-rose-600">
            {errorMessage}
          </p>
        ) : null}

        {!ready ? (
          <p className="rounded-2xl bg-white/70 px-4 py-6 text-center text-sm text-slate-400">
            내역을 불러오는 중...
          </p>
        ) : expenses.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-slate-300 bg-white/50 px-4 py-6 text-center text-sm text-slate-400">
            아직 저장된 지출이 없습니다.
          </p>
        ) : (
          <ul className="max-h-[28vh] space-y-2 overflow-y-auto overscroll-contain pr-0.5">
            {expenses.map((item) => (
              <li
                key={item.id}
                className="flex items-center justify-between gap-3 rounded-2xl bg-white px-4 py-3 shadow-sm"
              >
                <div className="min-w-0">
                  <p className="truncate text-[15px] font-medium text-slate-900">
                    {item.description}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {formatDate(item.date)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <p className="text-[15px] font-semibold tabular-nums text-slate-900">
                    {formatAmount(item.amount)}원
                  </p>
                  <button
                    type="button"
                    onClick={() => void removeExpense(item.id)}
                    className="inline-flex h-9 min-w-9 items-center justify-center rounded-xl text-xs text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
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

      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col">
        <div className="flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-4">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <p
                className={`max-w-[78%] whitespace-pre-wrap break-words px-3.5 py-2.5 text-[15px] leading-relaxed shadow-sm ${
                  message.role === "user"
                    ? "rounded-[18px] rounded-tr-md bg-[#fee500] text-slate-900"
                    : "rounded-[18px] rounded-tl-md bg-white text-slate-800"
                }`}
              >
                {message.text}
              </p>
            </div>
          ))}

          {sending ? (
            <div className="flex justify-start">
              <div className="flex items-center gap-1 rounded-[18px] rounded-tl-md bg-white px-4 py-3 shadow-sm">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.2s]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.1s]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" />
              </div>
            </div>
          ) : null}

          <div ref={bottomRef} />
        </div>

        <form
          onSubmit={handleSubmit}
          className="sticky bottom-0 border-t border-black/5 bg-[#f5f5f5] px-3 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
        >
          <div className="flex items-end gap-2">
            <label className="sr-only" htmlFor="chat-input">
              메시지
            </label>
            <textarea
              id="chat-input"
              ref={inputRef}
              rows={1}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="지출을 말하거나 물어보세요"
              enterKeyHint="send"
              className="max-h-28 min-h-11 flex-1 resize-none rounded-[22px] border-0 bg-white px-4 py-2.5 text-[15px] text-slate-900 outline-none ring-1 ring-slate-200 placeholder:text-slate-400 focus:ring-2 focus:ring-yellow-400"
            />
            <button
              type="submit"
              disabled={sending || !input.trim()}
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#fee500] text-slate-900 shadow-sm transition hover:bg-[#f7d800] disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-white"
              aria-label="전송"
            >
              <svg
                viewBox="0 0 24 24"
                className="h-5 w-5"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M2.01 21 23 12 2.01 3 2 10l15 2-15 2z" />
              </svg>
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}
