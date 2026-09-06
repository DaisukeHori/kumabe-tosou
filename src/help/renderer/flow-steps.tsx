import type { HelpFlowStep } from "../types";
import { InlineText } from "./inline-text";

/**
 * 「利用のフロー」の番号付きカード。カードとカードの間に下向きの矢印を挟む。
 * 1 ステップ = 何をする / どこを押す / 終わるとどうなる の 3 点セット。
 */
export function FlowSteps({ steps }: { steps: HelpFlowStep[] }) {
  return (
    <ol className="flex list-none flex-col gap-0 p-0" data-help-flow="">
      {steps.map((step, index) => (
        <li key={index} className="flex flex-col items-stretch">
          <div className="flex gap-3 rounded-lg border border-border bg-card p-4">
            <span
              className="flex size-7 shrink-0 items-center justify-center rounded-full bg-foreground text-xs font-extrabold text-white"
              aria-hidden="true"
            >
              {index + 1}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-bold text-foreground">
                <InlineText text={step.step} />
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                <span className="font-semibold">どこを押す: </span>
                <InlineText text={step.where} />
              </p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                <span className="font-semibold">終わるとどうなる: </span>
                <InlineText text={step.result} />
              </p>
            </div>
          </div>
          {index < steps.length - 1 ? (
            <span className="py-1 text-center text-lg leading-none text-muted-foreground" aria-hidden="true">
              ↓
            </span>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
