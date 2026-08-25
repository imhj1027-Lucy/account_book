import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { NextResponse } from "next/server";
import { supabase, type Expense, type ExpenseInsert } from "@/lib/supabase";

type ChatTurn = {
  role: "user" | "model";
  text: string;
};

type ChatRequest = {
  message?: unknown;
  history?: unknown;
};

type Intent = "question" | "expense" | "chat";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const QUESTION_MARKERS =
  /얼마|얼마나|뭐|뭘|무슨|어떤|어떻게|언제|어디|누구|왜|몇|어느|\?|？|알려|보여|합계|총액|총지출|통계|분석|정리|비교|가장|제일/;

function todayLocal() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return `${year}-${month}-${day}`;
}

function addDays(iso: string, days: number) {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

function startOfWeekMonday(iso: string) {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const weekday = date.getUTCDay();
  const diff = weekday === 0 ? -6 : 1 - weekday;
  date.setUTCDate(date.getUTCDate() + diff);
  return date.toISOString().slice(0, 10);
}

function lastDayOfMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function dateContext(today: string) {
  const [year, month] = today.split("-").map(Number);
  const thisMonthStart = `${today.slice(0, 8)}01`;
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  const prevMonthStart = `${prevYear}-${String(prevMonth).padStart(2, "0")}-01`;
  const prevMonthEnd = `${prevYear}-${String(prevMonth).padStart(2, "0")}-${String(lastDayOfMonth(prevYear, prevMonth)).padStart(2, "0")}`;
  const thisWeekStart = startOfWeekMonday(today);
  const lastWeekEnd = addDays(thisWeekStart, -1);
  const lastWeekStart = addDays(thisWeekStart, -7);

  return {
    today,
    yesterday: addDays(today, -1),
    thisMonthStart,
    thisMonthEnd: today,
    prevMonthStart,
    prevMonthEnd,
    thisWeekStart,
    lastWeekStart,
    lastWeekEnd,
  };
}

function isChatTurn(value: unknown): value is ChatTurn {
  if (!value || typeof value !== "object") return false;
  const turn = value as ChatTurn;
  return (
    (turn.role === "user" || turn.role === "model") &&
    typeof turn.text === "string" &&
    turn.text.trim().length > 0
  );
}

function hasAmount(message: string) {
  const text = message.replace(/,/g, "").replace(/\s+/g, "");
  return (
    /\d+원/.test(text) ||
    /\d+만원/.test(text) ||
    /\d+천원/.test(text) ||
    /\d+만\d*천?원?/.test(text) ||
    /\d+천/.test(text)
  );
}

function detectIntent(message: string): Intent {
  if (QUESTION_MARKERS.test(message)) return "question";
  if (hasAmount(message)) return "expense";
  return "chat";
}

function sanitizeDraft(value: unknown): ExpenseInsert | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<ExpenseInsert>;
  const date = typeof item.date === "string" ? item.date.trim() : "";
  const description =
    typeof item.description === "string" ? item.description.trim() : "";
  const amount = Number(item.amount);

  if (!DATE_PATTERN.test(date)) return null;
  if (!description) return null;
  if (!Number.isFinite(amount) || amount <= 0) return null;

  return {
    date,
    amount: Math.round(amount),
    description: description.slice(0, 80),
  };
}

function parseModelJson(text: string): { reply: string; expenses: unknown[] } {
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const parsed = JSON.parse(cleaned) as {
    reply?: unknown;
    expenses?: unknown;
  };

  return {
    reply:
      typeof parsed.reply === "string" && parsed.reply.trim()
        ? parsed.reply.trim()
        : "기록했어요.",
    expenses: Array.isArray(parsed.expenses) ? parsed.expenses : [],
  };
}

function formatExpenseLines(expenses: Pick<Expense, "date" | "amount" | "description">[]) {
  if (expenses.length === 0) return "(아직 저장된 지출 없음)";
  return expenses
    .map((item) => `- ${item.date} / ${item.amount}원 / ${item.description}`)
    .join("\n");
}

async function loadAllExpenses() {
  const { data, error } = await supabase
    .from("expenses")
    .select("date, amount, description")
    .order("date", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    throw error;
  }

  return data ?? [];
}

export async function POST(request: Request) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "GEMINI_API_KEY가 설정되어 있지 않습니다." },
      { status: 500 },
    );
  }

  let body: ChatRequest;
  try {
    body = (await request.json()) as ChatRequest;
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) {
    return NextResponse.json(
      { error: "메시지를 입력해 주세요." },
      { status: 400 },
    );
  }

  const history = Array.isArray(body.history)
    ? body.history.filter(isChatTurn).slice(-12)
    : [];
  const intent = detectIntent(message);
  const today = todayLocal();
  const dates = dateContext(today);

  let storedExpenses: Pick<Expense, "date" | "amount" | "description">[] = [];
  try {
    storedExpenses = await loadAllExpenses();
  } catch (error) {
    console.error("Failed to load expenses:", error);
    return NextResponse.json(
      { error: "지출 내역을 불러오지 못했어요. 잠시 후 다시 시도해 주세요." },
      { status: 500 },
    );
  }

  const expenseLines = formatExpenseLines(storedExpenses);
  const canSaveExpense = intent === "expense";

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: "gemini-3.6-flash",
    systemInstruction: `당신은 친근한 한국어 가계부 챗봇입니다.
오늘 날짜는 ${dates.today} (Asia/Seoul)입니다.
기간 기준:
- 어제: ${dates.yesterday}
- 이번 달: ${dates.thisMonthStart} ~ ${dates.thisMonthEnd}
- 지난달: ${dates.prevMonthStart} ~ ${dates.prevMonthEnd}
- 이번 주(월~오늘): ${dates.thisWeekStart} ~ ${dates.today}
- 지난주(월~일): ${dates.lastWeekStart} ~ ${dates.lastWeekEnd}

이번 요청 유형: ${intent}

규칙:
- question: 저장된 지출 데이터만 근거로 분석해서 답하세요. expenses는 반드시 빈 배열입니다. 금액은 천 단위 쉼표로 말하고, 자연스럽고 친근한 한국어 2~5문장으로 답하세요. 항목이 여러 개면 짧게 나열해도 됩니다. 식비는 점심/저녁/아침/커피/식당/배달/분식처럼 먹는 것과 관련된 내용을 포함해 판단하세요. 데이터가 없으면 없다고 말하세요. 없는 지출을 지어내지 마세요.
- expense: 사용자가 말한 지출만 expenses 배열에 넣으세요. date는 YYYY-MM-DD, 날짜가 없으면 오늘, "어제"는 ${dates.yesterday}. amount는 원 단위 양의 정수("8천원"=8000, "1만 2천원"=12000). description은 짧은 한글. reply는 내용과 금액을 확인하는 한두 문장.
- chat: 가벼운 대화에 답하고 expenses는 빈 배열입니다.

사용자가 말하지 않은 지출을 지어내지 마세요.`,
    generationConfig: {
      temperature: intent === "question" ? 0.4 : 0.3,
      responseMimeType: "application/json",
      responseSchema: {
        type: SchemaType.OBJECT,
        properties: {
          reply: { type: SchemaType.STRING },
          expenses: {
            type: SchemaType.ARRAY,
            items: {
              type: SchemaType.OBJECT,
              properties: {
                date: { type: SchemaType.STRING },
                amount: { type: SchemaType.INTEGER },
                description: { type: SchemaType.STRING },
              },
              required: ["date", "amount", "description"],
            },
          },
        },
        required: ["reply", "expenses"],
      },
    },
  });

  const contents = [
    {
      role: "user" as const,
      parts: [
        {
          text: `저장된 전체 지출 내역(${storedExpenses.length}건, 날짜순):\n${expenseLines}`,
        },
      ],
    },
    {
      role: "model" as const,
      parts: [
        {
          text: JSON.stringify({
            reply: "네, 저장된 내역을 모두 확인했어요. 편하게 말씀해 주세요.",
            expenses: [],
          }),
        },
      ],
    },
    ...history.map((turn) => ({
      role: turn.role,
      parts: [{ text: turn.text }],
    })),
    {
      role: "user" as const,
      parts: [{ text: message }],
    },
  ];

  try {
    const result = await model.generateContent({ contents });
    const text = result.response.text();
    const parsed = parseModelJson(text);
    const drafts = canSaveExpense
      ? parsed.expenses
          .map(sanitizeDraft)
          .filter((item): item is ExpenseInsert => item !== null)
      : [];

    let saved: Expense[] = [];
    if (drafts.length > 0) {
      const { data, error } = await supabase
        .from("expenses")
        .insert(drafts)
        .select();

      if (error) {
        return NextResponse.json({
          reply: `${parsed.reply}\n\n다만 저장에는 실패했어요. 잠시 후 다시 시도해 주세요.`,
          expenses: [],
        });
      }

      saved = data ?? [];
    }

    return NextResponse.json({
      reply: parsed.reply,
      expenses: saved,
    });
  } catch (error) {
    console.error("Gemini chat error:", error);
    return NextResponse.json(
      { error: "AI 응답을 만들지 못했습니다. 잠시 후 다시 시도해 주세요." },
      { status: 502 },
    );
  }
}
