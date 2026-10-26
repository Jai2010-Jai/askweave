import { useState, useEffect } from 'react';
import { Play, Pause, CheckCheck, Send, Car, Hotel, Globe, Pizza, Smartphone } from 'lucide-react';

type Scenario = 'cab' | 'hotel' | 'website' | 'food';

export const WhatsAppSimulator: React.FC = () => {
  const [activeScenario, setActiveScenario] = useState<Scenario>('cab');
  const [isVoicePlaying, setIsVoicePlaying] = useState(false);
  const [voiceProgress, setVoiceProgress] = useState(0);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (isVoicePlaying) {
      interval = setInterval(() => {
        setVoiceProgress((prev) => {
          if (prev >= 100) {
            setIsVoicePlaying(false);
            return 0;
          }
          return prev + 10;
        });
      }, 200);
    } else {
      setVoiceProgress(0);
    }
    return () => clearInterval(interval);
  }, [isVoicePlaying]);

  return (
    <div className="flex flex-col gap-3 w-full max-w-[480px] mx-auto">
      {/* Scenario Pill Buttons */}
      <div className="flex flex-wrap gap-1.5 p-1 bg-[#f4ebe6] rounded-xl border border-[#ead6cd]">
        <button
          onClick={() => { setActiveScenario('cab'); setIsVoicePlaying(false); }}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
            activeScenario === 'cab'
              ? 'bg-[#ff5100] text-white shadow-sm font-bold'
              : 'text-[#59534E] hover:text-[#1d110c] hover:bg-[#ece0dc]'
          }`}
        >
          <Car className="size-3.5" />
          <span>Book a Cab</span>
        </button>

        <button
          onClick={() => { setActiveScenario('hotel'); setIsVoicePlaying(false); }}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
            activeScenario === 'hotel'
              ? 'bg-[#ff5100] text-white shadow-sm font-bold'
              : 'text-[#59534E] hover:text-[#1d110c] hover:bg-[#ece0dc]'
          }`}
        >
          <Hotel className="size-3.5" />
          <span>Book a Hotel</span>
        </button>

        <button
          onClick={() => { setActiveScenario('website'); setIsVoicePlaying(false); }}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
            activeScenario === 'website'
              ? 'bg-[#ff5100] text-white shadow-sm font-bold'
              : 'text-[#59534E] hover:text-[#1d110c] hover:bg-[#ece0dc]'
          }`}
        >
          <Globe className="size-3.5" />
          <span>Make a Website</span>
        </button>

        <button
          onClick={() => { setActiveScenario('food'); setIsVoicePlaying(false); }}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
            activeScenario === 'food'
              ? 'bg-[#ff5100] text-white shadow-sm font-bold'
              : 'text-[#59534E] hover:text-[#1d110c] hover:bg-[#ece0dc]'
          }`}
        >
          <Pizza className="size-3.5" />
          <span>Order Food</span>
        </button>
      </div>

      {/* Realistic WhatsApp Phone Frame */}
      <div className="rounded-2xl border-2 border-[#d3cec2] bg-[#efeae2] shadow-xl overflow-hidden flex flex-col font-sans">
        {/* WhatsApp Top Bar */}
        <div className="bg-[#075e54] text-white px-4 py-3 flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="size-9 rounded-full bg-[#ff5100] text-white flex items-center justify-center font-bold text-sm shadow">
                W
              </div>
              <span className="absolute bottom-0 right-0 size-2.5 rounded-full bg-emerald-400 border-2 border-[#075e54]"></span>
            </div>
            <div>
              <div className="text-sm font-bold flex items-center gap-1">
                <span>Weave Assistant</span>
                <span className="text-[10px] bg-white/20 px-1.5 py-0.2 rounded font-normal">AI</span>
              </div>
              <div className="text-[11px] text-emerald-200">Online • Running on your PC</div>
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs text-white/80">
            <Smartphone className="size-4" />
          </div>
        </div>

        {/* WhatsApp Chat Body */}
        <div 
          className="p-4 space-y-3 min-h-[310px] max-h-[340px] overflow-y-auto flex flex-col justify-end text-xs"
          style={{
            backgroundImage: `radial-gradient(#d3cec2 0.75px, transparent 0.75px)`,
            backgroundSize: '12px 12px'
          }}
        >
          {/* SCENARIO 1: CAB */}
          {activeScenario === 'cab' && (
            <>
              {/* User Voice Note */}
              <div className="self-end max-w-[85%] bg-[#d9fdd3] text-[#111b21] p-2.5 rounded-2xl rounded-tr-xs shadow-sm space-y-1">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setIsVoicePlaying(!isVoicePlaying)}
                    className="size-7 rounded-full bg-[#128c7e] text-white flex items-center justify-center shrink-0 shadow-sm cursor-pointer"
                  >
                    {isVoicePlaying ? <Pause className="size-3.5" /> : <Play className="size-3.5 ml-0.5" />}
                  </button>
                  <div className="flex-1 space-y-0.5">
                    <div className="h-1.5 bg-[#128c7e]/30 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-[#128c7e] transition-all duration-200" 
                        style={{ width: isVoicePlaying ? `${voiceProgress}%` : '40%' }}
                      ></div>
                    </div>
                    <div className="flex justify-between text-[9px] text-stone-500">
                      <span>{isVoicePlaying ? '0:03' : '0:04'}</span>
                      <span className="flex items-center text-[#53bdeb]"><CheckCheck className="size-3" /></span>
                    </div>
                  </div>
                </div>
                <div className="text-[11px] text-stone-600 italic pt-0.5">
                  "Hey Weave, book me a cab to JFK airport in 20 minutes"
                </div>
              </div>

              {/* Weave Reply */}
              <div className="self-start max-w-[88%] bg-white text-[#111b21] p-3 rounded-2xl rounded-tl-xs shadow-sm space-y-2">
                <p className="text-[11px] leading-relaxed">
                  🚕 Checked Uber &amp; Lyft for you! Found an <strong>UberX</strong> arriving in <strong>8 minutes</strong> for <strong>$24.50</strong>.
                </p>

                {/* Outcome card */}
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-2.5 space-y-1">
                  <div className="flex items-center justify-between font-bold text-emerald-900 text-[11px]">
                    <span>✓ Ride Confirmed</span>
                    <span>$24.50</span>
                  </div>
                  <div className="text-[10px] text-emerald-800">
                    Driver: <strong>Michael (Toyota Camry)</strong> • Lic: 7XYZ89
                  </div>
                  <div className="text-[9px] text-stone-500">
                    Pickup: Current Location • ETA: 8 mins
                  </div>
                </div>

                <div className="flex items-center justify-between text-[9px] text-stone-400 pt-0.5">
                  <span>14:22 PM</span>
                  <span className="text-emerald-600 font-semibold">Done in 2.1s</span>
                </div>
              </div>
            </>
          )}

          {/* SCENARIO 2: HOTEL */}
          {activeScenario === 'hotel' && (
            <>
              {/* User Text */}
              <div className="self-end max-w-[85%] bg-[#d9fdd3] text-[#111b21] p-2.5 rounded-2xl rounded-tr-xs shadow-sm space-y-1">
                <p className="text-[11px] leading-relaxed">
                  Find me a cozy hotel in Paris near the Eiffel Tower for under $150/night this weekend!
                </p>
                <div className="text-[9px] text-stone-500 flex justify-end gap-1">
                  <span>15:10 PM</span>
                  <span className="text-[#53bdeb]"><CheckCheck className="size-3" /></span>
                </div>
              </div>

              {/* Weave Reply */}
              <div className="self-start max-w-[88%] bg-white text-[#111b21] p-3 rounded-2xl rounded-tl-xs shadow-sm space-y-2">
                <p className="text-[11px] leading-relaxed">
                  🏨 Compared 14 stays! Here is the top-rated match:
                </p>

                {/* Outcome card */}
                <div className="rounded-xl border border-stone-200 bg-[#fbf9f5] p-2.5 space-y-1.5">
                  <div className="flex items-center justify-between font-bold text-[#1d110c] text-[11px]">
                    <span>Hotel Gustave (Paris)</span>
                    <span className="text-[#ff5100]">$135 / night</span>
                  </div>
                  <div className="text-[10px] text-stone-600">
                    ⭐ 4.8 / 5 • 8 min walk to Eiffel Tower • Free breakfast
                  </div>
                  <div className="text-[10px] bg-emerald-100 text-emerald-800 font-medium px-2 py-0.5 rounded text-center">
                    Ready to book! Reply "Confirm" to reserve.
                  </div>
                </div>

                <div className="flex items-center justify-between text-[9px] text-stone-400 pt-0.5">
                  <span>15:11 PM</span>
                  <span className="text-emerald-600 font-semibold">Saved you $45</span>
                </div>
              </div>
            </>
          )}

          {/* SCENARIO 3: WEBSITE */}
          {activeScenario === 'website' && (
            <>
              {/* User Voice Note */}
              <div className="self-end max-w-[85%] bg-[#d9fdd3] text-[#111b21] p-2.5 rounded-2xl rounded-tr-xs shadow-sm space-y-1">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setIsVoicePlaying(!isVoicePlaying)}
                    className="size-7 rounded-full bg-[#128c7e] text-white flex items-center justify-center shrink-0 shadow-sm cursor-pointer"
                  >
                    {isVoicePlaying ? <Pause className="size-3.5" /> : <Play className="size-3.5 ml-0.5" />}
                  </button>
                  <div className="flex-1 space-y-0.5">
                    <div className="h-1.5 bg-[#128c7e]/30 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-[#128c7e] transition-all duration-200" 
                        style={{ width: isVoicePlaying ? `${voiceProgress}%` : '55%' }}
                      ></div>
                    </div>
                    <div className="flex justify-between text-[9px] text-stone-500">
                      <span>0:06</span>
                      <span className="text-[#53bdeb]"><CheckCheck className="size-3" /></span>
                    </div>
                  </div>
                </div>
                <div className="text-[11px] text-stone-600 italic pt-0.5">
                  "Make a modern website for my coffee shop 'Daily Roast' with menu &amp; contact form"
                </div>
              </div>

              {/* Weave Reply */}
              <div className="self-start max-w-[88%] bg-white text-[#111b21] p-3 rounded-2xl rounded-tl-xs shadow-sm space-y-2">
                <p className="text-[11px] leading-relaxed">
                  🌐 Your website is built and live on the internet! Here is your preview:
                </p>

                {/* Outcome card */}
                <div className="rounded-xl border border-stone-200 bg-stone-900 text-white p-2.5 space-y-1.5">
                  <div className="flex items-center justify-between text-[10px] text-stone-300">
                    <span className="font-bold text-[#ff7836]">Daily Roast Cafe</span>
                    <span className="text-emerald-400 text-[9px]">• Published</span>
                  </div>
                  <div className="bg-stone-800 rounded p-2 text-center text-[10px] text-stone-200 border border-stone-700">
                    ☕ Specialty Brews • Bakery • Catering
                  </div>
                  <div className="text-[9px] text-stone-400 underline truncate">
                    https://dailyroast.pages.dev
                  </div>
                </div>

                <div className="flex items-center justify-between text-[9px] text-stone-400 pt-0.5">
                  <span>11:45 AM</span>
                  <span className="text-emerald-600 font-semibold">Coded in 4.2s</span>
                </div>
              </div>
            </>
          )}

          {/* SCENARIO 4: FOOD */}
          {activeScenario === 'food' && (
            <>
              {/* User Text */}
              <div className="self-end max-w-[85%] bg-[#d9fdd3] text-[#111b21] p-2.5 rounded-2xl rounded-tr-xs shadow-sm space-y-1">
                <p className="text-[11px] leading-relaxed">
                  Reorder my favorite pepperoni pizza and garlic bread from Mario's!
                </p>
                <div className="text-[9px] text-stone-500 flex justify-end gap-1">
                  <span>19:20 PM</span>
                  <span className="text-[#53bdeb]"><CheckCheck className="size-3" /></span>
                </div>
              </div>

              {/* Weave Reply */}
              <div className="self-start max-w-[88%] bg-white text-[#111b21] p-3 rounded-2xl rounded-tl-xs shadow-sm space-y-2">
                <p className="text-[11px] leading-relaxed">
                  🍕 Ordered from Mario's Pizzeria. Used your saved address &amp; promo code!
                </p>

                {/* Outcome card */}
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-2.5 space-y-1">
                  <div className="flex items-center justify-between font-bold text-amber-950 text-[11px]">
                    <span>✓ Order #482 Placed</span>
                    <span>$18.90</span>
                  </div>
                  <div className="text-[10px] text-amber-900">
                    1x Large Pepperoni Pizza, 1x Garlic Breadsticks
                  </div>
                  <div className="text-[9px] text-stone-500">
                    Arriving in ~25-30 mins at your front door
                  </div>
                </div>

                <div className="flex items-center justify-between text-[9px] text-stone-400 pt-0.5">
                  <span>19:21 PM</span>
                  <span className="text-emerald-600 font-semibold">Done</span>
                </div>
              </div>
            </>
          )}
        </div>

        {/* WhatsApp Fake Input Footer */}
        <div className="bg-[#f0f2f5] p-2 flex items-center gap-2 border-t border-stone-200">
          <div className="flex-1 bg-white rounded-full px-3 py-1.5 text-[11px] text-stone-400 flex items-center justify-between shadow-xs">
            <span>Type a message or send voice note...</span>
          </div>
          <div className="size-8 rounded-full bg-[#128c7e] text-white flex items-center justify-center shrink-0 shadow">
            <Send className="size-3.5" />
          </div>
        </div>
      </div>
    </div>
  );
};
