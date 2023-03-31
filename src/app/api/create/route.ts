import { NextRequest, NextResponse } from "next/server";
import rateLimit from "@/utils/rate-limit";

type Scheduler = "DDIM" | "K_EULER" | "DPMSolverMultistep";

type RequestBody = {
  prompt: string;
  advancedPrompt: {
    negativePrompt: string;
    scheduler: Scheduler;
    inferenceSteps: number;
    seed: number;
  };
};

// 8 requests per hour
const REQUESTS_PER_INTERVAL = 20;
const INTERVAL = 60 * 1000 * 60;
const limiter = rateLimit({ interval: INTERVAL });

const MAX_PROMPT_LENGTH = 600;

const STABLE_DIFFUSION_VERSION =
  "9936c2001faa2194a261c01381f90e65261879985476014a0a37a334593a05eb";

/**
 * @name POST /api/create
 * @summary Generate a new image from a text prompt
 * @param request {NextRequest}
 */
export async function POST(request: NextRequest) {
  const body: RequestBody = await request.json();
  const prompt: string = body.prompt;
  const advancedPrompt = body.advancedPrompt;

  if (!prompt) {
    return NextResponse.json({ detail: "Prompt is required" }, { status: 400 });
  }

  if (prompt.length >= MAX_PROMPT_LENGTH) {
    return NextResponse.json(
      { detail: `Prompt must be less than ${MAX_PROMPT_LENGTH} characters` },
      { status: 400 }
    );
  }

  const { isLimitExceeded, responseHeaders } = limiter.check(
    REQUESTS_PER_INTERVAL
  );

  /**
   * Get the current hour plus one hour in 12-hour format
   * @returns {string} The formatted time
   */
  const getCurrentHourPlusOne = (): string => {
    const date = new Date();
    const hour = date.getHours() + 1;
    const minutes = date.getMinutes();
    const ampm = hour >= 12 ? "PM" : "AM";
    const hour12 = hour % 12 || 12;
    const minutesFormatted = minutes < 10 ? `0${minutes}` : minutes;
    return `${hour12}:${minutesFormatted} ${ampm}`;
  };

  if (isLimitExceeded) {
    return NextResponse.json(
      {
        detail: `Rate limit exceeded. Please try again later in 1 hour (around ${getCurrentHourPlusOne()}).`,
      },
      { status: 429, headers: responseHeaders }
    );
  }

  const response = await fetch("https://api.replicate.com/v1/predictions", {
    method: "POST",
    headers: {
      Authorization: `Token ${process.env.REPLICATE_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      version: STABLE_DIFFUSION_VERSION,
      input: {
        prompt,
        negative_prompt: advancedPrompt.negativePrompt,
        scheduler: advancedPrompt.scheduler,
        num_inference_steps: advancedPrompt.inferenceSteps,
        seed: advancedPrompt.seed,
      },
    }),
  });

  if (response.status !== 201) {
    let error = await response.json();
    return NextResponse.json(
      { detail: error.detail },
      { status: 500, headers: responseHeaders }
    );
  }

  const prediction = await response.json();

  return NextResponse.json(prediction, {
    status: 201,
    headers: responseHeaders,
  });
}
