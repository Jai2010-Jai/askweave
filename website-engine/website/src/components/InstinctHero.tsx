import { useState, useEffect } from 'react';
import { Download, Play, Pause, CheckCheck, Check } from 'lucide-react';
import confetti from 'canvas-confetti';

interface InstinctHeroProps {
  onOpenDownload: () => void;
}

type TaskType = 'cab' | 'hotel' | 'website' | 'food';

export const InstinctHero: React.FC<InstinctHeroProps> = ({ onOpenDownload }) => {
  const [activeTask, setActiveTask] = useState<TaskType>('cab');
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [audioProgress, setAudioProgress] = useState(0);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (isPlayingAudio) {
      interval = setInterval(() => {
        setAudioProgress((prev) => {
          if (prev >= 100) {
            setIsPlayingAudio(false);
            return 0;
          }
          return prev + 12;
        });
      }, 200);
    } else {
      setAudioProgress(0);
    }
    return () => clearInterval(interval);
  }, [isPlayingAudio]);

  const handleDownloadClick = () => {
    confetti({
      particleCount: 50,
      spread: 60,
      origin: { y: 0.7 },
      colors: ['#ff5100', '#128c7e', '#1d110c', '#f4ebe6']
    });
    onOpenDownload();
  };

  return (
    <section className="flex flex-col gap-10 py-6 sm:py-12 max-w-3xl mx-auto font-sans" id="what-it-does">
      {/* Editorial Headline Statement */}
      <div className="flex flex-col gap-6">
        <h1 className="text-3xl sm:text-5xl font-bold leading-[1.18] tracking-[-0.02em] text-[#1d110c]">
          Weave is a personal assistant that lives on your computer and gets things done for you.
        </h1>

        <p className="text-lg sm:text-xl leading-relaxed text-[#59534E] font-normal">
          The interface is simple: <strong className="text-[#1d110c] font-semibold">there are no new interfaces</strong>. You just text or send voice notes on WhatsApp. It uses your computer in the same way that you do.
        </p>

        {/* Instinct-style Interactive Task Sentence with Inline Badges */}
        <p className="text-lg sm:text-xl leading-relaxed text-[#59534E]">
          It can{' '}
          <button
            onClick={() => { setActiveTask('cab'); setIsPlayingAudio(false); }}
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-base font-semibold transition-all cursor-pointer mx-1 my-1 border ${
              activeTask === 'cab'
                ? 'bg-[#ff5100] text-white border-[#ff5100] shadow-sm scale-105'
                : 'bg-[#f4ebe6] text-[#1d110c] border-[#ead6cd] hover:border-[#ff5100]'
            }`}
          >
            <span>🚕</span>
            <span>book a cab when you're in a hurry</span>
          </button>
          ,{' '}
          <button
            onClick={() => { setActiveTask('hotel'); setIsPlayingAudio(false); }}
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-base font-semibold transition-all cursor-pointer mx-1 my-1 border ${
              activeTask === 'hotel'
                ? 'bg-[#ff5100] text-white border-[#ff5100] shadow-sm scale-105'
                : 'bg-[#f4ebe6] text-[#1d110c] border-[#ead6cd] hover:border-[#ff5100]'
            }`}
          >
            <span>🏨</span>
            <span>reserve a hotel for the weekend</span>
          </button>
          ,{' '}
          <button
            onClick={() => { setActiveTask('website'); setIsPlayingAudio(false); }}
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-base font-semibold transition-all cursor-pointer mx-1 my-1 border ${
              activeTask === 'website'
                ? 'bg-[#ff5100] text-white border-[#ff5100] shadow-sm scale-105'
                : 'bg-[#f4ebe6] text-[#1d110c] border-[#ead6cd] hover:border-[#ff5100]'
            }`}
          >
            <span>🌐</span>
            <span>build a website for your business</span>
          </button>
          , or{' '}
          <button
            onClick={() => { setActiveTask('food'); setIsPlayingAudio(false); }}
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-base font-semibold transition-all cursor-pointer mx-1 my-1 border ${
              activeTask === 'food'
                ? 'bg-[#ff5100] text-white border-[#ff5100] shadow-sm scale-105'
                : 'bg-[#f4ebe6] text-[#1d110c] border-[#ead6cd] hover:border-[#ff5100]'
            }`}
          >
            <span>🍕</span>
            <span>order dinner</span>
          </button>
          .
        </p>
      </div>

      {/* Live Interactive WhatsApp Chat Preview Card */}
      <div className="rounded-3xl border border-[#ead6cd] bg-white p-5 sm:p-7 shadow-sm flex flex-col gap-4">
        {/* Chat Header */}
        <div className="flex items-center justify-between border-b border-[#f4ebe6] pb-3 text-xs text-[#59534E]">
          <div className="flex items-center gap-2">
            <span className="size-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <span className="font-bold text-[#1d110c]">WhatsApp with Weave</span>
            <span>•</span>
            <span>Running on your PC</span>
          </div>
          <span className="text-[11px] text-[#a16245] font-medium">Click any task above to preview</span>
        </div>

        {/* Chat Messages */}
        <div className="space-y-3 py-1 text-xs sm:text-sm">
          {/* TASK: CAB */}
          {activeTask === 'cab' && (
            <>
              <div className="self-end ml-auto max-w-[85%] bg-[#d9fdd3] text-[#111b21] p-3 rounded-2xl rounded-tr-xs shadow-xs space-y-1.5">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setIsPlayingAudio(!isPlayingAudio)}
                    className="size-7 rounded-full bg-[#128c7e] text-white flex items-center justify-center shrink-0 cursor-pointer shadow-xs"
                  >
                    {isPlayingAudio ? <Pause className="size-3.5" /> : <Play className="size-3.5 ml-0.5" />}
                  </button>
                  <div className="flex-1 space-y-0.5">
                    <div className="h-1.5 bg-[#128c7e]/30 rounded-full overflow-hidden">
                      <div className="h-full bg-[#128c7e] transition-all" style={{ width: isPlayingAudio ? `${audioProgress}%` : '40%' }}></div>
                    </div>
                    <div className="flex justify-between text-[10px] text-stone-500">
                      <span>{isPlayingAudio ? '0:03' : '0:04'}</span>
                      <span className="text-[#53bdeb]"><CheckCheck className="size-3.5 inline" /></span>
                    </div>
                  </div>
                </div>
                <div className="text-xs text-stone-700 italic">"Book me a cab to JFK airport in 20 minutes"</div>
              </div>

              <div className="mr-auto max-w-[90%] bg-[#f4ebe6]/50 border border-[#ead6cd] text-[#111b21] p-3.5 rounded-2xl rounded-tl-xs shadow-xs space-y-2">
                <p className="text-xs sm:text-sm leading-relaxed">
                  🚕 Checked Uber &amp; Lyft for you! Found an <strong>UberX</strong> arriving in <strong>8 minutes</strong> for <strong>$24.50</strong>.
                </p>
                <div className="rounded-xl border border-emerald-300 bg-emerald-50/80 p-2.5 space-y-1">
                  <div className="flex justify-between font-bold text-emerald-900 text-xs">
                    <span>✓ Ride Confirmed</span>
                    <span>$24.50</span>
                  </div>
                  <div className="text-[11px] text-emerald-800">
                    Driver: <strong>Michael (Toyota Camry)</strong> • Lic: 7XYZ89 • ETA: 8 mins
                  </div>
                </div>
                <div className="text-[10px] text-stone-400 text-right">Done in 2.1s • 100% on your PC</div>
              </div>
            </>
          )}

          {/* TASK: HOTEL */}
          {activeTask === 'hotel' && (
            <>
              <div className="self-end ml-auto max-w-[85%] bg-[#d9fdd3] text-[#111b21] p-3 rounded-2xl rounded-tr-xs shadow-xs space-y-1">
                <p className="text-xs sm:text-sm">Find me a cozy hotel in Paris near the Eiffel Tower for under $150/night for this weekend</p>
                <div className="text-[10px] text-stone-500 flex justify-end gap-1">
                  <span>15:10 PM</span>
                  <span className="text-[#53bdeb]"><CheckCheck className="size-3.5 inline" /></span>
                </div>
              </div>

              <div className="mr-auto max-w-[90%] bg-[#f4ebe6]/50 border border-[#ead6cd] text-[#111b21] p-3.5 rounded-2xl rounded-tl-xs shadow-xs space-y-2">
                <p className="text-xs sm:text-sm leading-relaxed">
                  🏨 Compared 14 stays! Best match: <strong>Hotel Gustave (Paris)</strong> at <strong>$135 / night</strong>.
                </p>
                <div className="rounded-xl border border-stone-300 bg-white p-2.5 space-y-1 text-xs">
                  <div className="font-bold text-[#1d110c]">Hotel Gustave • 4.8 / 5 Stars</div>
                  <div className="text-[11px] text-[#59534E]">8 min walk to Eiffel Tower • Free cancellation • Breakfast included</div>
                  <div className="bg-emerald-100 text-emerald-900 font-semibold px-2 py-0.5 rounded text-center text-[11px]">
                    Ready to book! Reply "Confirm" to reserve.
                  </div>
                </div>
                <div className="text-[10px] text-stone-400 text-right">Saved you $45 • 100% on your PC</div>
              </div>
            </>
          )}

          {/* TASK: WEBSITE */}
          {activeTask === 'website' && (
            <>
              <div className="self-end ml-auto max-w-[85%] bg-[#d9fdd3] text-[#111b21] p-3 rounded-2xl rounded-tr-xs shadow-xs space-y-1.5">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setIsPlayingAudio(!isPlayingAudio)}
                    className="size-7 rounded-full bg-[#128c7e] text-white flex items-center justify-center shrink-0 cursor-pointer shadow-xs"
                  >
                    {isPlayingAudio ? <Pause className="size-3.5" /> : <Play className="size-3.5 ml-0.5" />}
                  </button>
                  <div className="flex-1 space-y-0.5">
                    <div className="h-1.5 bg-[#128c7e]/30 rounded-full overflow-hidden">
                      <div className="h-full bg-[#128c7e] transition-all" style={{ width: isPlayingAudio ? `${audioProgress}%` : '55%' }}></div>
                    </div>
                    <div className="flex justify-between text-[10px] text-stone-500">
                      <span>0:06</span>
                      <span className="text-[#53bdeb]"><CheckCheck className="size-3.5 inline" /></span>
                    </div>
                  </div>
                </div>
                <div className="text-xs text-stone-700 italic">"Make a modern website for my coffee shop 'Daily Roast' with a menu &amp; contact form"</div>
              </div>

              <div className="mr-auto max-w-[90%] bg-[#f4ebe6]/50 border border-[#ead6cd] text-[#111b21] p-3.5 rounded-2xl rounded-tl-xs shadow-xs space-y-2">
                <p className="text-xs sm:text-sm leading-relaxed">
                  🌐 Your website is coded and published live! Here is your preview:
                </p>
                <div className="rounded-xl border border-stone-800 bg-[#181311] text-white p-3 space-y-1.5">
                  <div className="flex justify-between text-xs font-mono">
                    <span className="text-[#ff7836] font-bold">Daily Roast Cafe</span>
                    <span className="text-emerald-400">• Published</span>
                  </div>
                  <div className="bg-stone-800 rounded p-2 text-center text-xs text-stone-200">
                    ☕ Specialty Brews • Bakery • Catering
                  </div>
                  <div className="text-[11px] text-stone-400 font-mono underline">
                    https://dailyroast.pages.dev
                  </div>
                </div>
                <div className="text-[10px] text-stone-400 text-right">Created in 4.2s • Zero code needed</div>
              </div>
            </>
          )}

          {/* TASK: FOOD */}
          {activeTask === 'food' && (
            <>
              <div className="self-end ml-auto max-w-[85%] bg-[#d9fdd3] text-[#111b21] p-3 rounded-2xl rounded-tr-xs shadow-xs space-y-1">
                <p className="text-xs sm:text-sm">Reorder my usual spicy chicken bowl from Chipotle for dinner</p>
                <div className="text-[10px] text-stone-500 flex justify-end gap-1">
                  <span>19:20 PM</span>
                  <span className="text-[#53bdeb]"><CheckCheck className="size-3.5 inline" /></span>
                </div>
              </div>

              <div className="mr-auto max-w-[90%] bg-[#f4ebe6]/50 border border-[#ead6cd] text-[#111b21] p-3.5 rounded-2xl rounded-tl-xs shadow-xs space-y-2">
                <p className="text-xs sm:text-sm leading-relaxed">
                  🍕 Order placed at Chipotle (Broadway branch)! Used your saved card &amp; address.
                </p>
                <div className="rounded-xl border border-amber-300 bg-amber-50 p-2.5 space-y-1 text-xs">
                  <div className="flex justify-between font-bold text-amber-950">
                    <span>✓ Order #482 Placed</span>
                    <span>$14.80</span>
                  </div>
                  <div className="text-[11px] text-amber-900">1x Spicy Chicken Burrito Bowl • Arriving in 25-30 mins</div>
                </div>
                <div className="text-[10px] text-stone-400 text-right">Done • 100% on your PC</div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Prominent Download Area */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4 pt-2">
        <button
          onClick={handleDownloadClick}
          className="flex h-13 items-center justify-center gap-2.5 rounded-full bg-[#ff5100] px-8 text-base font-bold text-white hover:bg-[#e04500] active:scale-[0.98] shadow-md shadow-[#ff5100]/25 transition-all cursor-pointer"
        >
          <Download className="size-5" />
          <span>Download Weave for Mac &amp; Windows</span>
        </button>
      </div>

      {/* Instinct Reassurance Footnote */}
      <div className="flex flex-wrap items-center gap-y-2 gap-x-4 text-xs text-[#59534E]">
        <span className="flex items-center gap-1 font-semibold text-emerald-800">
          <Check className="size-3.5 text-emerald-600 stroke-[3]" /> Free download
        </span>
        <span>•</span>
        <span className="flex items-center gap-1 font-semibold text-emerald-800">
          <Check className="size-3.5 text-emerald-600 stroke-[3]" /> 2-minute setup
        </span>
        <span>•</span>
        <span className="flex items-center gap-1 font-semibold text-emerald-800">
          <Check className="size-3.5 text-emerald-600 stroke-[3]" /> Zero coding needed
        </span>
        <span>•</span>
        <span className="flex items-center gap-1 font-semibold text-emerald-800">
          <Check className="size-3.5 text-emerald-600 stroke-[3]" /> 100% private on your computer
        </span>
      </div>
    </section>
  );
};
