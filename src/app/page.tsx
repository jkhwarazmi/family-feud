"use client";
import { useState, useEffect } from 'react';
import { Settings, Monitor, Trophy } from 'lucide-react';
import confetti from 'canvas-confetti';
import { db } from '@/lib/firebase';
import { ref, onValue, set, update } from 'firebase/database';
import { INITIAL_ROUNDS } from '@/lib/gameData';

// --- COMPONENTS (Unchanged) ---

const StrikeOverlay = ({ count, lastStrikeTime }: { count: number, lastStrikeTime: number }) => {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const isRecent = Date.now() - lastStrikeTime < 2000;
    if (count > 0 && isRecent) {
      setVisible(true);
      const timer = setTimeout(() => setVisible(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [count, lastStrikeTime]);

  if (!visible) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none bg-black/40 backdrop-blur-[2px]">
      <div className="flex space-x-4 animate-bounce">
        {[...Array(count)].map((_, i) => (
          <div key={i} className="text-red-600 font-sans text-[200px] md:text-[300px] font-black drop-shadow-[0_0_25px_rgba(255,0,0,0.8)] leading-none border-4 border-white bg-red-800 rounded-xl px-4 flex items-center justify-center">X</div>
        ))}
      </div>
    </div>
  );
};

const AnswerSlot = ({ answer, index, multiplier }: { answer?: any, index: number, multiplier: number }) => {
  if (!answer) {
    return (
      <div className="h-20 md:h-24 w-full bg-blue-900/30 border-2 border-blue-800/50 rounded flex items-center justify-center relative overflow-hidden">
        <div className="absolute inset-0 opacity-20 bg-[radial-gradient(circle,_#1e3a8a_2px,_transparent_2px)] [background-size:10px_10px]" />
      </div>
    );
  }
  return (
    <div className="h-20 md:h-24 w-full relative flex bg-gradient-to-b from-blue-700 to-blue-900 border-[3px] border-yellow-500 shadow-lg overflow-hidden group rounded-sm">
      <div className={`flex-grow flex items-center pl-4 md:pl-6 transition-opacity duration-500 ${answer.revealed ? 'opacity-100' : 'opacity-0'}`}>
        <span className="text-white font-bold text-lg md:text-2xl uppercase tracking-wider drop-shadow-md truncate">{answer.text}</span>
      </div>
      <div className={`w-20 md:w-24 h-full bg-blue-950 border-l-[3px] border-yellow-500 flex items-center justify-center transition-opacity duration-500 ${answer.revealed ? 'opacity-100' : 'opacity-0'}`}>
        <span className="text-yellow-400 font-mono text-2xl md:text-4xl font-bold">{answer.points * multiplier}</span>
      </div>
      {!answer.revealed && (
        <div className="absolute inset-0 bg-gradient-to-b from-blue-600 to-blue-800 z-10 flex items-center justify-center border-b-4 border-blue-900/50">
          <div className="w-12 h-10 md:w-16 md:h-12 bg-blue-950 rounded-[50%] flex items-center justify-center border-2 border-blue-400 shadow-[inset_0_2px_6px_rgba(0,0,0,0.5)]">
            <span className="text-white font-bold text-xl md:text-2xl font-mono shadow-black drop-shadow-sm">{index + 1}</span>
          </div>
        </div>
      )}
    </div>
  );
};

// --- MAIN PAGE ---

export default function Home() {
  const [view, setView] = useState<'landing' | 'host' | 'board'>('landing');
  const [gameState, setGameState] = useState<any>(null);
  const [hostCode, setHostCode] = useState('');

  // 1. LISTEN TO FIREBASE (Replaces Polling)
  useEffect(() => {
    if (view === 'landing') return;

    const gameRef = ref(db, 'game');
    const unsubscribe = onValue(gameRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        // Check for winner locally to trigger confetti
        if (data.winner && !gameState?.winner && view === 'board') {
            confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
        }
        setGameState(data);
      } else {
        // If DB is empty, initialize it
        resetGame();
      }
    });

    return () => unsubscribe();
  }, [view]);

  // 2. ACTIONS (Updates Firebase directly)
  const resetGame = () => {
    set(ref(db, 'game'), {
        currentRoundIndex: 0,
        scores: { team1: 0, team2: 0 },
        roundPoints: 0,
        strikes: 0,
        lastStrikeTime: 0,
        rounds: INITIAL_ROUNDS,
        winner: null,
    });
  };

  const performAction = (action: string, payload: any = {}) => {
    if (!gameState) return;
    const updates: any = {};
    const currentRound = gameState.rounds[gameState.currentRoundIndex];

    switch (action) {
        case 'REVEAL_ANSWER':
            const answer = currentRound.answers[payload.index];
            if (!answer.revealed) {
                // Update the specific answer's revealed state
                updates[`game/rounds/${gameState.currentRoundIndex}/answers/${payload.index}/revealed`] = true;
                // Add points to pot
                updates['game/roundPoints'] = gameState.roundPoints + (answer.points * currentRound.multiplier);
            }
            break;

        case 'ADD_STRIKE':
            if (gameState.strikes < 3) {
                updates['game/strikes'] = gameState.strikes + 1;
                updates['game/lastStrikeTime'] = Date.now();
            }
            break;

        case 'CLEAR_STRIKES':
            updates['game/strikes'] = 0;
            break;

        case 'AWARD_ROUND':
             // Add pot to team score
             const currentScore = gameState.scores[payload.team];
             updates[`game/scores/${payload.team}`] = currentScore + gameState.roundPoints;
             updates['game/roundPoints'] = 0;
             updates['game/strikes'] = 0;
             // Reveal all answers for this round
             gameState.rounds[gameState.currentRoundIndex].answers.forEach((_: any, idx: number) => {
                 updates[`game/rounds/${gameState.currentRoundIndex}/answers/${idx}/revealed`] = true;
             });
             break;

        case 'NEXT_ROUND':
             if (gameState.currentRoundIndex < gameState.rounds.length - 1) {
                 updates['game/currentRoundIndex'] = gameState.currentRoundIndex + 1;
                 updates['game/roundPoints'] = 0;
                 updates['game/strikes'] = 0;
             } else {
                 const winner = gameState.scores.team1 > gameState.scores.team2 ? "Team 1" : "Team 2";
                 updates['game/winner'] = gameState.scores.team1 === gameState.scores.team2 ? "Draw" : winner;
             }
             break;
    }

    if (Object.keys(updates).length > 0) {
        update(ref(db), updates);
    }
  };

  if (view === 'landing') {
    return (
      <div className="min-h-screen bg-blue-950 flex flex-col items-center justify-center text-white font-sans p-4">
        <h1 className="text-6xl font-extrabold text-yellow-400 mb-8 drop-shadow-md text-center">FAMILY FEUD</h1>
        <div className="flex flex-col md:flex-row gap-4">
          <button onClick={() => setView('board')} className="px-8 py-4 bg-blue-600 hover:bg-blue-500 rounded-lg text-xl font-bold transition shadow-lg border-b-4 border-blue-800">
            Join as Board
          </button>
          <div className="flex flex-col gap-2">
             <input type="password" placeholder="Host Code" className="px-4 py-2 text-black rounded shadow-inner" onChange={(e) => setHostCode(e.target.value)}/>
             <button onClick={() => hostCode === 'admin' ? setView('host') : alert('Wrong Code (Try: admin)')} className="px-8 py-2 bg-yellow-500 hover:bg-yellow-400 text-blue-900 rounded-lg font-bold transition shadow-lg border-b-4 border-yellow-600">
              Login as Host
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!gameState) return <div className="text-white bg-blue-950 h-screen flex items-center justify-center">Connecting to Game...</div>;
  const currentRound = gameState.rounds[gameState.currentRoundIndex];

  // --- BOARD VIEW ---
  if (view === 'board') {
    if (gameState.winner) {
       return (
        <div className="min-h-screen bg-blue-950 flex flex-col items-center justify-center text-white">
          <Trophy size={120} className="text-yellow-400 mb-6 animate-bounce" />
          <h1 className="text-6xl font-bold mb-4">WINNER</h1>
          <h2 className="text-8xl font-black text-yellow-400 drop-shadow-[0_5px_5px_rgba(0,0,0,0.8)]">{gameState.winner.toUpperCase()}</h2>
          <div className="mt-12 text-3xl font-bold bg-blue-900 px-8 py-4 rounded-xl border-4 border-yellow-500">
            Team 1: {gameState.scores.team1}  |  Team 2: {gameState.scores.team2}
          </div>
        </div>
       )
    }

    return (
      <div className="min-h-screen bg-blue-950 p-6 flex flex-col items-center font-sans overflow-hidden bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-blue-900 via-blue-950 to-black">
        <StrikeOverlay count={gameState.strikes} lastStrikeTime={gameState.lastStrikeTime} />
        <div className="w-full max-w-7xl flex justify-between items-start mb-8 md:mb-12 text-white relative z-10 pt-4">
          <div className="bg-blue-900 border-4 border-yellow-500 p-4 rounded-xl w-32 md:w-48 text-center shadow-2xl relative mt-4">
            <h3 className="text-sm md:text-lg font-bold mb-1 text-blue-200 tracking-widest">TEAM 1</h3>
            <span className="text-4xl md:text-6xl font-black block leading-none">{gameState.scores.team1}</span>
          </div>
          <div className="flex flex-col items-center">
            <div className="relative mb-4">
                <div className="absolute -inset-4 bg-yellow-500/20 blur-xl rounded-full"></div>
                <div className="relative bg-black border-[3px] border-yellow-600 px-8 md:px-12 py-2 rounded-lg shadow-2xl">
                    <span className="text-4xl md:text-6xl font-mono text-yellow-500 font-bold tracking-widest drop-shadow-[0_0_10px_rgba(234,179,8,0.5)]">{gameState.roundPoints}</span>
                </div>
            </div>
            <div className="h-12 flex items-center justify-center gap-2">
               {gameState.strikes >= 1 && <span className="text-red-600 font-black text-4xl drop-shadow-[0_2px_2px_rgba(0,0,0,0.8)]">X</span>}
               {gameState.strikes >= 2 && <span className="text-red-600 font-black text-4xl drop-shadow-[0_2px_2px_rgba(0,0,0,0.8)]">X</span>}
               {gameState.strikes >= 3 && <span className="text-red-600 font-black text-4xl drop-shadow-[0_2px_2px_rgba(0,0,0,0.8)]">X</span>}
            </div>
          </div>
          <div className="bg-blue-900 border-4 border-yellow-500 p-4 rounded-xl w-32 md:w-48 text-center shadow-2xl mt-4">
            <h3 className="text-sm md:text-lg font-bold mb-1 text-blue-200 tracking-widest">TEAM 2</h3>
            <span className="text-4xl md:text-6xl font-black block leading-none">{gameState.scores.team2}</span>
          </div>
        </div>
        <div className="w-full max-w-6xl flex-grow flex flex-col items-center relative z-10">
          <div className="bg-blue-800/80 backdrop-blur-sm border-2 border-blue-400/30 p-4 rounded-xl mb-8 text-center max-w-4xl shadow-lg w-full">
             <h2 className="text-xl md:text-2xl text-white font-semibold leading-relaxed">{currentRound.question}</h2>
          </div>
          <div className="w-full grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-4">
             <div className="flex flex-col gap-3">
                {[0, 1, 2, 3].map(i => (<AnswerSlot key={i} index={i} answer={currentRound.answers[i]} multiplier={currentRound.multiplier} />))}
             </div>
             <div className="flex flex-col gap-3">
                {[4, 5, 6, 7].map(i => (<AnswerSlot key={i} index={i} answer={currentRound.answers[i]} multiplier={currentRound.multiplier} />))}
             </div>
          </div>
        </div>
      </div>
    );
  }

  // --- HOST VIEW ---
  return (
    <div className="min-h-screen bg-gray-50 p-6 font-sans text-gray-900">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="bg-white p-4 rounded-lg shadow-md border-b-4 border-gray-200 flex justify-between items-center">
          <h2 className="text-xl font-bold flex items-center gap-2 text-blue-900"><Settings className="text-blue-600" /> Host Control</h2>
          <div className="space-x-3">
            <button onClick={() => resetGame()} className="px-4 py-1 text-sm bg-red-100 text-red-700 rounded hover:bg-red-200 font-semibold">Reset Game</button>
            <span className="text-sm font-mono bg-blue-100 text-blue-800 px-3 py-1 rounded font-bold">Round {gameState.currentRoundIndex + 1} / 3</span>
          </div>
        </div>
        <div className="bg-blue-600 text-white p-6 rounded-lg shadow-md">
           <h3 className="text-2xl font-bold mb-2">Q: {currentRound.question}</h3>
           <p className="opacity-90 italic">💡 Host Tip: {currentRound.hostTip}</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-white p-5 rounded-lg shadow-md border border-gray-200">
            <h3 className="text-gray-400 text-xs font-bold uppercase tracking-wider mb-4">Reveal Answers</h3>
            <div className="space-y-2">
              {currentRound.answers.map((ans: any, idx: number) => (
                <button key={idx} onClick={() => performAction('REVEAL_ANSWER', { index: idx })} disabled={ans.revealed} className={`w-full flex justify-between px-4 py-3 rounded border-2 text-left transition-all ${ans.revealed ? 'bg-green-50 border-green-200 text-green-700 opacity-60' : 'bg-white hover:bg-blue-50 border-gray-200 hover:border-blue-300'}`}>
                  <span className="font-bold">#{idx + 1} {ans.text}</span>
                  <span className="font-mono font-bold bg-gray-100 px-2 rounded">{ans.points * currentRound.multiplier}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-6">
            <div className="bg-white p-5 rounded-lg shadow-md border border-gray-200">
              <h3 className="text-gray-400 text-xs font-bold uppercase tracking-wider mb-4">Strikes</h3>
              <div className="flex justify-center mb-6 h-16 items-center">
                 <div className="text-6xl font-black text-red-500 tracking-[1rem]">{gameState.strikes > 0 ? 'X'.repeat(gameState.strikes) : <span className="text-gray-300 text-2xl tracking-normal font-normal">No Strikes</span>}</div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <button onClick={() => performAction('ADD_STRIKE')} className="bg-red-600 hover:bg-red-700 text-white font-bold py-3 rounded shadow-sm transition transform active:scale-95">STRIKE (+1)</button>
                <button onClick={() => performAction('CLEAR_STRIKES')} className="bg-gray-100 hover:bg-gray-200 text-gray-600 font-bold py-3 rounded shadow-sm">Clear</button>
              </div>
            </div>
            <div className="bg-white p-5 rounded-lg shadow-md border border-gray-200">
              <h3 className="text-gray-400 text-xs font-bold uppercase tracking-wider mb-4">Award Points (Includes Steal)</h3>
              <div className="bg-yellow-50 border border-yellow-200 p-3 rounded mb-4 text-sm text-yellow-800"><strong>Steal Logic:</strong> If a team steals, 1) Click the answer they guessed to add it to the pot, 2) Click "Award Team".</div>
              <div className="grid grid-cols-2 gap-3 mb-4">
                <button onClick={() => performAction('AWARD_ROUND', { team: 'team1' })} className="bg-blue-100 hover:bg-blue-200 text-blue-800 py-3 rounded font-bold border border-blue-200">Award Team 1</button>
                <button onClick={() => performAction('AWARD_ROUND', { team: 'team2' })} className="bg-blue-100 hover:bg-blue-200 text-blue-800 py-3 rounded font-bold border border-blue-200">Award Team 2</button>
              </div>
              <button onClick={() => performAction('NEXT_ROUND')} className="w-full bg-yellow-400 hover:bg-yellow-500 text-yellow-900 font-bold py-4 rounded shadow-md flex items-center justify-center gap-2 transition transform active:scale-95">Start Next Round <Monitor size={20} /></button>
            </div>
          </div>
        </div>
      </div>
    </div>
    );
  }