import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { Mic, MicOff, Phone, PhoneOff, Send, Volume2, VolumeX } from 'lucide-react';
import type { CallRecord, CallStage } from '@onehuman/schemas';
import { Button } from '@/components/ui/button';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';

/**
 * Phone simulator. With the simulator provider, calls to staff ring here: you
 * answer as the person in charge, by voice or by typing, and the AI speaks its
 * side. Real calls (Twilio) are answered on the phone; this shows them live.
 */

const STAGE_LABEL: Record<CallStage, string> = {
  assign: 'Assigning work',
  follow_up: 'Follow-up',
  confirm: 'Confirming done',
  checkin: 'Daily check-in',
  collect: 'Collecting items',
  chase: 'Follow-up on an item',
};

const QUICK_REPLIES: Record<CallStage, string[]> = {
  assign: ['Yes, I can do it by tomorrow 5 pm', 'Sure, by Friday evening', "Sorry, I can't, I'm on leave"],
  follow_up: ["It's on track", 'I need more time, by Friday', "There's a problem, I'm waiting for the keys"],
  confirm: ["Yes, it's done", 'Not yet, still pending'],
  checkin: [],
  collect: [],
  chase: [],
};

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

function getRecognition(): SpeechRecognitionLike | null {
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!Ctor) return null;
  const r = new Ctor();
  r.lang = 'en-IN';
  r.interimResults = false;
  return r;
}

function speak(text: string) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-IN';
  u.rate = 1.03;
  window.speechSynthesis.speak(u);
}

/** Staff are named by first name; an outside party by their whole name, as they have no first-name footing here. */
const asWho = (c: CallRecord) => (c.contact ? c.staffName : c.staffName.split(' ')[0]);

export function PhoneSimulator() {
  const queryClient = useQueryClient();
  const active = useQuery({
    queryKey: ['calls', 'active'],
    queryFn: api.calls.active,
    // Real calls update their transcript turn by turn without an event, so poll faster while one is live.
    refetchInterval: (q) => (q.state.data?.some((c) => c.provider !== 'simulator') ? 2000 : 5000),
  });
  const [current, setCurrent] = useState<CallRecord | null>(null);
  const [text, setText] = useState('');
  const [voiceOn, setVoiceOn] = useState(true);
  const [listening, setListening] = useState(false);
  const recognition = useRef<SpeechRecognitionLike | null>(null);
  const spokenCount = useRef(0);
  const bottom = useRef<HTMLDivElement>(null);

  const ringing = active.data?.find((c) => c.provider === 'simulator' && c.status === 'ringing');
  const live = active.data?.find((c) => c.provider !== 'simulator');
  const call = current ?? ringing ?? null;
  const ended = current?.status === 'completed' || current?.status === 'no_answer';

  // Speak each new AI line once.
  useEffect(() => {
    if (!current) {
      spokenCount.current = 0;
      return;
    }
    const aiLines = current.transcript.filter((l) => l.speaker === 'ai');
    if (voiceOn && aiLines.length > spokenCount.current) speak(aiLines[aiLines.length - 1]!.text);
    spokenCount.current = aiLines.length;
    bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [current, voiceOn]);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['calls'] });
    void queryClient.invalidateQueries({ queryKey: ['delegations'] });
  };
  const answer = useMutation({ mutationFn: (id: string) => api.calls.answer(id), onSuccess: (c) => (setCurrent(c), refresh()) });
  const decline = useMutation({ mutationFn: (id: string) => api.calls.decline(id), onSuccess: () => (setCurrent(null), refresh()) });
  const reply = useMutation({
    mutationFn: (t: string) => api.calls.reply(current!.id, t),
    onSuccess: (c) => {
      setText('');
      setCurrent(c);
      refresh();
    },
  });

  const listen = () => {
    if (listening) {
      recognition.current?.stop();
      return;
    }
    const r = getRecognition();
    if (!r) return;
    recognition.current = r;
    r.onresult = (e) => {
      const said = e.results[0]?.[0]?.transcript;
      if (said) reply.mutate(said);
    };
    r.onend = () => setListening(false);
    setListening(true);
    r.start();
  };

  if (!call) return live ? <LiveCall call={live} /> : null;

  // Ringing card
  if (!current) {
    return (
      <motion.div initial={{ opacity: 0, y: 40, scale: 0.94 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 320, damping: 26 }} className="fixed right-4 bottom-4 z-50 w-[22rem] max-w-[calc(100vw-2rem)] overflow-hidden glass rounded-lg" role="dialog" aria-label="Incoming call">
        <div className="hero-glow px-5 pt-5 pb-4">
          <p className="text-xs font-medium tracking-wide text-fg-muted uppercase">Simulated call · {STAGE_LABEL[call.stage]}</p>
          <div className="mt-3 flex items-center gap-3">
            <span className="ringing grid size-11 place-items-center rounded-full bg-success-soft text-success">
              <Phone className="size-5" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="truncate font-semibold text-fg">AI is calling {call.staffName}</p>
              <p className="truncate text-sm text-fg-muted">{call.staffTitle} · attempt {call.attempt}</p>
            </div>
          </div>
          <p className="mt-3 line-clamp-2 text-sm text-fg">{call.delegationTitle}</p>
          {call.contact && (
            <p className="mt-2 text-xs text-warning">
              A customer or supplier: answer as them. Nothing they say changes the item until you apply it.
            </p>
          )}
          <p className="mt-2 text-xs text-fg-muted">Answer as {asWho(call)} to try the conversation. No real phone is dialled yet.</p>
        </div>
        <div className="flex gap-2 border-t border-border p-3">
          <Button variant="success" className="flex-1" onClick={() => answer.mutate(call.id)} loading={answer.isPending}>
            <Phone /> Answer
          </Button>
          <Button variant="secondary" className="flex-1 text-danger" onClick={() => decline.mutate(call.id)} loading={decline.isPending}>
            <PhoneOff /> Decline
          </Button>
        </div>
        {(answer.error || decline.error) && <p className="px-4 pb-3 text-sm text-danger">{errorMessage(answer.error ?? decline.error)}</p>}
      </motion.div>
    );
  }

  // In-call conversation
  return (
    <motion.div initial={{ opacity: 0, y: 40, scale: 0.94 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 320, damping: 26 }} className="fixed right-4 bottom-4 z-50 flex max-h-[min(36rem,calc(100vh-2rem))] w-[24rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden glass rounded-lg" role="dialog" aria-label={`Call with ${current.staffName}`}>
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <span className={cn('grid size-9 place-items-center rounded-full', ended ? 'bg-line-10 text-fg-muted' : 'bg-success-soft text-success')}>
          <Phone className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-fg">You are {current.staffName}</p>
          <p className="truncate text-xs text-fg-muted">{ended ? 'Call ended' : `On call · ${STAGE_LABEL[current.stage]}`}</p>
          {current.about && <p className="truncate text-xs text-fg-muted">About {current.about.title}</p>}
        </div>
        <Button variant="ghost" size="icon" onClick={() => setVoiceOn((v) => !v)} aria-label={voiceOn ? 'Mute AI voice' : 'Play AI voice'}>
          {voiceOn ? <Volume2 /> : <VolumeX />}
        </Button>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-3" aria-live="polite">
        {current.transcript.map((l, i) => (
          <div key={i} className={cn('flex', l.speaker === 'person' ? 'justify-end' : 'justify-start')}>
            <p className={cn('max-w-[85%] rounded-2xl px-3 py-2 text-sm', l.speaker === 'person' ? 'rounded-br-sm bg-primary text-primary-fg' : 'rounded-bl-sm bg-muted text-fg')}>
              {l.text}
            </p>
          </div>
        ))}
        {ended && current.summary && (
          <p className="rounded-lg border border-success/30 bg-success-soft px-3 py-2 text-sm text-fg">
            <span className="font-medium">Outcome:</span> {current.summary}
          </p>
        )}
        <div ref={bottom} />
      </div>

      {ended ? (
        <div className="border-t border-border p-3">
          <Button variant="secondary" className="w-full" onClick={() => setCurrent(null)}>
            Close
          </Button>
        </div>
      ) : (
        <div className="space-y-2 border-t border-border p-3">
          <div className="flex flex-wrap gap-1.5">
            {(current.suggestions ?? QUICK_REPLIES[current.stage]).map((q) => (
              <button key={q} onClick={() => reply.mutate(q)} disabled={reply.isPending} className="rounded-full border border-border px-2.5 py-1 text-xs text-fg-muted hover:border-primary hover:text-fg disabled:opacity-50">
                {q}
              </button>
            ))}
          </div>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (text.trim()) reply.mutate(text.trim());
            }}
          >
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={`Reply as ${asWho(current)}…`}
              className="h-9 min-w-0 flex-1 rounded-md border border-border bg-background px-3 text-sm text-fg placeholder:text-fg-muted/70 focus:border-primary focus:outline-none"
              aria-label="Your reply"
            />
            {getRecognition() && (
              <Button type="button" variant={listening ? 'danger' : 'secondary'} size="icon" onClick={listen} aria-label={listening ? 'Stop listening' : 'Speak'}>
                {listening ? <MicOff /> : <Mic />}
              </Button>
            )}
            <Button type="submit" size="icon" loading={reply.isPending} aria-label="Send">
              <Send />
            </Button>
          </form>
          {reply.error && <p className="text-sm text-danger">{errorMessage(reply.error)}</p>}
        </div>
      )}
    </motion.div>
  );
}

/** A real phone call in progress: who is being called, and the conversation as it happens. */
function LiveCall({ call }: { call: CallRecord }) {
  const bottom = useRef<HTMLDivElement>(null);
  const [hidden, setHidden] = useState<string | null>(null);
  useEffect(() => bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }), [call.transcript.length]);
  if (hidden === call.id) return null;
  const ringing = call.status === 'ringing';
  return (
    <motion.div initial={{ opacity: 0, y: 40, scale: 0.94 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 320, damping: 26 }} className="fixed right-4 bottom-4 z-50 flex max-h-[min(32rem,calc(100vh-2rem))] w-[24rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden glass rounded-lg" role="status" aria-label={`Phone call with ${call.staffName}`}>
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <span className={cn('grid size-9 place-items-center rounded-full bg-success-soft text-success', ringing && 'ringing')}>
          <Phone className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-fg">{ringing ? `Calling ${call.staffName}…` : `On the phone with ${call.staffName}`}</p>
          <p className="truncate text-xs text-fg-muted">Real call · {STAGE_LABEL[call.stage]} · attempt {call.attempt}</p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setHidden(call.id)}>Hide</Button>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-3" aria-live="polite">
        {call.transcript.length === 0 && <p className="text-sm text-fg-muted">{call.delegationTitle}</p>}
        {call.transcript.map((l, i) => (
          <div key={i} className={cn('flex', l.speaker === 'person' ? 'justify-end' : 'justify-start')}>
            <p className={cn('max-w-[85%] rounded-2xl px-3 py-2 text-sm', l.speaker === 'person' ? 'rounded-br-sm bg-primary text-primary-fg' : 'rounded-bl-sm bg-muted text-fg')}>
              {l.text}
            </p>
          </div>
        ))}
        <div ref={bottom} />
      </div>
    </motion.div>
  );
}
