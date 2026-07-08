"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { Channel } from "@/modules/platform/contracts";
import type { StyleProfileView } from "@/modules/distribution/contracts";

import { updateStyleProfileAction } from "./actions";
import { CHANNELS_FORM_INITIAL_STATE } from "./form-state";

const CHANNEL_LABELS: Record<Channel, string> = {
  site_blog: "自サイトブログ",
  note: "note",
  x: "X",
  instagram: "Instagram",
};

const CHANNELS: Channel[] = ["site_blog", "note", "x", "instagram"];

export function StyleProfileForms({ data }: { data: Record<Channel, StyleProfileView | null> }) {
  return (
    <div className="rounded-xl border bg-background p-4">
      <h2 className="font-heading text-sm font-semibold">チャネル別文体プロファイル</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        AI 生成時のプロンプトに注入される文体指示・構成ルールです (設計書 §7.4)。
      </p>
      <Tabs defaultValue="site_blog" className="mt-4">
        <TabsList variant="line">
          {CHANNELS.map((c) => (
            <TabsTrigger key={c} value={c}>
              {CHANNEL_LABELS[c]}
            </TabsTrigger>
          ))}
        </TabsList>
        {CHANNELS.map((c) => (
          <TabsContent key={c} value={c} className="mt-4">
            <StyleProfileForm channel={c} profile={data[c]} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

function StyleProfileForm({ channel, profile }: { channel: Channel; profile: StyleProfileView | null }) {
  const boundAction = updateStyleProfileAction.bind(null, channel);
  const [state, action, isPending] = useActionState(boundAction, CHANNELS_FORM_INITIAL_STATE);

  useEffect(() => {
    if (state.success) toast.success(`${CHANNEL_LABELS[channel]} の文体プロファイルを保存しました。`);
  }, [state.success, channel]);

  return (
    <form action={action} className="max-w-2xl">
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor={`${channel}-tone`}>文体指示 (tone_instructions)</FieldLabel>
          <Textarea
            id={`${channel}-tone`}
            name="tone_instructions"
            defaultValue={profile?.tone_instructions ?? ""}
            required
            maxLength={2000}
            className="min-h-24"
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${channel}-format`}>構成ルール (format_rules)</FieldLabel>
          <Textarea
            id={`${channel}-format`}
            name="format_rules"
            defaultValue={profile?.format_rules ?? ""}
            required
            maxLength={2000}
            className="min-h-24"
            placeholder="字数 / ハッシュタグ数 / 絵文字方針など"
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${channel}-example`}>お手本出力 (example_output、任意)</FieldLabel>
          <Textarea
            id={`${channel}-example`}
            name="example_output"
            defaultValue={profile?.example_output ?? ""}
            maxLength={10000}
            className="min-h-24"
          />
        </Field>
      </FieldGroup>
      {state.error && <p className="mt-2 text-sm text-destructive">{state.error}</p>}
      <Button type="submit" disabled={isPending} className="mt-4">
        {isPending ? "保存中..." : "保存"}
      </Button>
    </form>
  );
}
