"use client";
import { useState, useEffect } from 'react';
import { Settings, Monitor, Trophy, Copy, X as XIcon, Play, Lightbulb, Eye } from 'lucide-react';
import confetti from 'canvas-confetti';
import { db } from '@/lib/firebase';
import { ref, onValue, set, update, get } from 'firebase/database';
import { INITIAL_ROUNDS, type Round } from '@/lib/gameData';
import { nanoid } from 'nanoid';

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

export default function Home() {
  const [view, setView] = useState<'landing' | 'host' | 'board'>('landing');
  const [gameState, setGameState] = useState<any>(null);
  const [sessionCode, setSessionCode] = useState('');
  const [inputCode, setInputCode] = useState('');
  const [hostCode, setHostCode] = useState('');
  const [isHost, setIsHost] = useState(false);
  const [rounds, setRounds] = useState<Round[]>([]);

  // ?code= links open straight onto the board
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const code = params.get('code');
      if (code) {
        setInputCode(code);
        setTimeout(() => {
          const checkAndJoin = async () => {
            const sessionRef = ref(db, `sessions/${code.toUpperCase()}`);
            const snapshot = await get(sessionRef);
            if (snapshot.exists()) {
              setSessionCode(code.toUpperCase());
              setIsHost(false);
              setView('board');
            }
          };
          checkAndJoin();
        }, 100);
      }
    }
  }, []);

  const createNewSession = async () => {
    const newCode = nanoid(6).toUpperCase();
    const newHostCode = `${newCode}-HOST`;

    const sessionRef = ref(db, `sessions/${newCode}`);
    await set(sessionRef, {
      gameState: {
        currentRoundIndex: 0,
        scores: { team1: 0, team2: 0 },
        roundPoints: 0,
        strikes: 0,
        lastStrikeTime: 0,
        winner: null,
      },
      rounds: INITIAL_ROUNDS,
      hostCode: newHostCode,
      createdAt: Date.now(),
    });

    setSessionCode(newCode);
    setHostCode(newHostCode);
    setIsHost(true);
    setView('host');
  };

  const joinAsBoard = async () => {
    if (!inputCode) {
      alert('Please enter a session code');
      return;
    }

    const sessionRef = ref(db, `sessions/${inputCode.toUpperCase()}`);
    const snapshot = await get(sessionRef);

    if (!snapshot.exists()) {
      alert('Session not found. Please check the code.');
      return;
    }

    setSessionCode(inputCode.toUpperCase());
    setIsHost(false);
    setView('board');
  };

  const joinAsHost = async () => {
    if (!inputCode) {
      alert('Please enter a host code');
      return;
    }

    const code = inputCode.toUpperCase();
    const parts = code.split('-');

    if (parts.length !== 2 || parts[1] !== 'HOST') {
      alert('Invalid host code format');
      return;
    }

    const sessionRef = ref(db, `sessions/${parts[0]}`);
    const snapshot = await get(sessionRef);

    if (!snapshot.exists()) {
      alert('Session not found');
      return;
    }

    const data = snapshot.val();
    if (data.hostCode !== code) {
      alert('Invalid host code');
      return;
    }

    setSessionCode(parts[0]);
    setHostCode(code);
    setIsHost(true);
    setView('host');
  };

  useEffect(() => {
    if (view === 'landing' || !sessionCode) return;

    const gameRef = ref(db, `sessions/${sessionCode}/gameState`);
    const roundsRef = ref(db, `sessions/${sessionCode}/rounds`);

    let previousGameState: any = null;

    const unsubGame = onValue(gameRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        if (data.winner && !previousGameState?.winner && view === 'board') {
          confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
        }

        previousGameState = data;
        setGameState(data);
      }
    });

    const unsubRounds = onValue(roundsRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        setRounds(data);
      }
    });

    return () => {
      unsubGame();
      unsubRounds();
    };
  }, [view, sessionCode, isHost]);

  const resetGame = () => {
    if (!sessionCode) return;

    update(ref(db), {
      [`sessions/${sessionCode}/gameState`]: {
        currentRoundIndex: 0,
        scores: { team1: 0, team2: 0 },
        roundPoints: 0,
        strikes: 0,
        lastStrikeTime: 0,
        winner: null,
      },
      [`sessions/${sessionCode}/rounds`]: INITIAL_ROUNDS,
    });
  };

  const performAction = (action: string, payload: any = {}) => {
    if (!gameState || !sessionCode) return;
    const updates: any = {};
    const currentRound = rounds[gameState.currentRoundIndex];

    switch (action) {
      case 'REVEAL_ANSWER':
        const answer = currentRound.answers[payload.index];
        if (!answer.revealed) {
          updates[`sessions/${sessionCode}/rounds/${gameState.currentRoundIndex}/answers/${payload.index}/revealed`] = true;
          updates[`sessions/${sessionCode}/gameState/roundPoints`] = gameState.roundPoints + (answer.points * currentRound.multiplier);
        }
        break;

      case 'ADD_STRIKE':
        if (gameState.strikes < 3) {
          updates[`sessions/${sessionCode}/gameState/strikes`] = gameState.strikes + 1;
          updates[`sessions/${sessionCode}/gameState/lastStrikeTime`] = Date.now();
        }
        break;

      case 'CLEAR_STRIKES':
        updates[`sessions/${sessionCode}/gameState/strikes`] = 0;
        break;

      case 'AWARD_ROUND':
        const currentScore = gameState.scores[payload.team];
        updates[`sessions/${sessionCode}/gameState/scores/${payload.team}`] = currentScore + gameState.roundPoints;
        updates[`sessions/${sessionCode}/gameState/roundPoints`] = 0;
        updates[`sessions/${sessionCode}/gameState/strikes`] = 0;
        rounds[gameState.currentRoundIndex].answers.forEach((_: any, idx: number) => {
          updates[`sessions/${sessionCode}/rounds/${gameState.currentRoundIndex}/answers/${idx}/revealed`] = true;
        });
        break;

      case 'NEXT_ROUND':
        if (gameState.currentRoundIndex < rounds.length - 1) {
          updates[`sessions/${sessionCode}/gameState/currentRoundIndex`] = gameState.currentRoundIndex + 1;
          updates[`sessions/${sessionCode}/gameState/roundPoints`] = 0;
          updates[`sessions/${sessionCode}/gameState/strikes`] = 0;
        } else {
          const winner = gameState.scores.team1 > gameState.scores.team2 ? "Team 1" : "Team 2";
          updates[`sessions/${sessionCode}/gameState/winner`] = gameState.scores.team1 === gameState.scores.team2 ? "Draw" : winner;
        }
        break;

      case 'UPDATE_MULTIPLIER':
        updates[`sessions/${sessionCode}/rounds/${payload.roundIndex}/multiplier`] = payload.multiplier;
        break;
    }

    if (Object.keys(updates).length > 0) {
      update(ref(db), updates);
    }
  };

  const copyJoinLink = () => {
    const link = `${window.location.origin}?code=${sessionCode}`;
    navigator.clipboard.writeText(link);
    alert('Join link copied to clipboard!');
  };

  // Landing Page
  if (view === 'landing') {
    return (
      <div className="min-h-screen bg-blue-950 flex flex-col items-center justify-center text-white font-sans p-4 relative">
        <h1 className="text-4xl md:text-6xl font-extrabold text-yellow-400 mb-8 drop-shadow-md text-center">FAMILY FEUD</h1>

        <div className="bg-blue-900 p-6 md:p-8 rounded-xl shadow-2xl border-4 border-yellow-500 max-w-md w-full space-y-6">
          <div className="space-y-3">
            <h2 className="text-xl font-bold text-center text-yellow-400">Join Game</h2>
            <input
              type="text"
              placeholder="Enter Session Code"
              className="w-full px-4 py-3 text-black rounded shadow-inner text-center font-mono text-lg uppercase"
              value={inputCode}
              onChange={(e) => setInputCode(e.target.value)}
            />
            <button
              onClick={joinAsBoard}
              className="w-full px-8 py-4 bg-blue-600 hover:bg-blue-500 rounded-lg text-xl font-bold transition shadow-lg border-b-4 border-blue-800"
            >
              <Monitor className="inline mr-2" size={24} />
              Join as Board
            </button>
          </div>

          <div className="border-t-2 border-blue-800 pt-6 space-y-3">
            <h2 className="text-xl font-bold text-center text-yellow-400">Host Game</h2>
            <button
              onClick={createNewSession}
              className="w-full px-8 py-4 bg-yellow-500 hover:bg-yellow-400 text-blue-900 rounded-lg text-xl font-bold transition shadow-lg border-b-4 border-yellow-600"
            >
              <Settings className="inline mr-2" size={24} />
              Create New Game
            </button>
            <div className="text-center text-sm text-blue-300">or</div>
            <input
              type="text"
              placeholder="Enter Host Code"
              className="w-full px-4 py-3 text-black rounded shadow-inner text-center font-mono uppercase"
              value={inputCode}
              onChange={(e) => setInputCode(e.target.value)}
            />
            <button
              onClick={joinAsHost}
              className="w-full px-8 py-3 bg-yellow-600 hover:bg-yellow-500 text-white rounded-lg font-bold transition shadow-lg"
            >
              Login as Host
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!gameState || !rounds.length) {
    return (
      <div className="text-white bg-blue-950 h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-yellow-400 mx-auto mb-4"></div>
          <p>Connecting to Game...</p>
        </div>
      </div>
    );
  }

  const currentRound = rounds[gameState.currentRoundIndex];

  // Board View
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
      );
    }

    return (
      <div className="min-h-screen bg-blue-950 p-4 md:p-6 flex flex-col items-center font-sans overflow-hidden bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-blue-900 via-blue-950 to-black relative">
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
          <div className="bg-blue-800/80 backdrop-blur-sm border-2 border-blue-400/30 p-4 rounded-xl mb-4 text-center max-w-4xl shadow-lg w-full">
            <h2 className="text-xl md:text-2xl text-white font-semibold leading-relaxed">{currentRound.question}</h2>
          </div>

          <div className="bg-blue-900 border-2 border-yellow-500 px-4 py-2 rounded-lg mb-6">
            <span className="text-yellow-400 font-mono font-bold text-lg">CODE: {sessionCode}</span>
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

  // Host View
  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-6 font-sans text-gray-900">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="bg-white p-6 rounded-xl shadow-lg border-2 border-blue-200">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl md:text-3xl font-bold flex items-center gap-3 text-blue-900">
              <Settings className="text-blue-600" size={32} /> Host Control
            </h2>
            <span className="text-lg font-mono bg-blue-100 text-blue-800 px-4 py-2 rounded-lg font-bold border-2 border-blue-300">
              Round {gameState.currentRoundIndex + 1} / {rounds.length}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-yellow-50 p-4 rounded-lg border-2 border-yellow-300 text-center">
              <div className="text-xs text-yellow-700 font-semibold uppercase tracking-wide mb-1">Session Code</div>
              <div className="font-mono font-bold text-2xl text-yellow-900">{sessionCode}</div>
            </div>

            <div className="bg-green-50 p-4 rounded-lg border-2 border-green-300 text-center">
              <div className="text-xs text-green-700 font-semibold uppercase tracking-wide mb-1">Host Code</div>
              <div className="font-mono font-bold text-lg text-green-900">{hostCode}</div>
            </div>

            <button
              onClick={copyJoinLink}
              className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold flex items-center justify-center gap-2 transition-colors shadow-md hover:shadow-lg p-4 w-full h-full min-h-[80px]"
            >
              <Copy size={20} />
              Copy Link
            </button>

            <button
              onClick={resetGame}
              className="bg-red-500 hover:bg-red-600 text-white rounded-lg font-bold transition-colors shadow-md hover:shadow-lg p-4 w-full h-full min-h-[80px]"
            >
              Reset Game
            </button>
          </div>
        </div>

        <div className="bg-gradient-to-br from-blue-600 to-blue-700 text-white p-6 rounded-xl shadow-xl border-2 border-blue-500">
          <div className="flex justify-between items-start mb-4">
            <div className="flex-1">
              <div className="text-sm font-semibold text-blue-200 mb-2 uppercase tracking-wide">Current Question</div>
              <h3 className="text-xl md:text-2xl font-bold leading-relaxed">{currentRound.question}</h3>
            </div>
            <div className="bg-yellow-400 text-blue-900 px-4 py-2 rounded-lg ml-4 flex-shrink-0">
              <span className="font-black text-xl">{currentRound.multiplier}x</span>
            </div>
          </div>
          <div className="bg-blue-800/50 p-3 rounded-lg border border-blue-500/50">
            <p className="text-sm flex items-start gap-2">
              <Lightbulb size={18} className="text-yellow-400 flex-shrink-0" />
              <span className="flex-1"><strong>Host Tip:</strong> {currentRound.hostTip}</span>
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white p-6 rounded-xl shadow-lg border-2 border-gray-200">
            <h3 className="text-blue-900 text-sm font-bold uppercase tracking-wider mb-4 flex items-center gap-2">
              <span className="bg-blue-100 p-2 rounded"><Eye size={16} /></span> Reveal Answers
            </h3>
            <div className="space-y-2">
              {currentRound.answers.map((ans: any, idx: number) => (
                <button
                  key={idx}
                  onClick={() => performAction('REVEAL_ANSWER', { index: idx })}
                  disabled={ans.revealed}
                  className={`w-full flex justify-between px-4 py-3 rounded-lg border-2 text-left transition-all ${
                    ans.revealed
                      ? 'bg-green-50 border-green-300 text-green-700 opacity-60 cursor-not-allowed'
                      : 'bg-white hover:bg-blue-50 border-gray-300 hover:border-blue-400 hover:shadow-md'
                  }`}
                >
                  <span className="font-bold">#{idx + 1} {ans.text}</span>
                  <span className="font-mono font-bold bg-blue-100 text-blue-900 px-3 py-1 rounded">{ans.points * currentRound.multiplier}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-6">
            <div className="bg-white p-6 rounded-xl shadow-lg border-2 border-gray-200">
              <h3 className="text-red-700 text-sm font-bold uppercase tracking-wider mb-4 flex items-center gap-2">
                <span className="bg-red-100 p-2 rounded"><XIcon size={16} /></span> Strikes
              </h3>
              <div className="flex justify-center mb-6 h-16 items-center">
                <div className="text-6xl font-black text-red-500 tracking-[1rem]">
                  {gameState.strikes > 0 ? 'X'.repeat(gameState.strikes) : <span className="text-gray-300 text-2xl tracking-normal font-normal">No Strikes</span>}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => performAction('ADD_STRIKE')}
                  className="bg-red-600 hover:bg-red-700 text-white font-bold py-3 rounded-lg shadow-md transition transform active:scale-95 hover:shadow-lg"
                >
                  STRIKE (+1)
                </button>
                <button
                  onClick={() => performAction('CLEAR_STRIKES')}
                  className="bg-gray-200 hover:bg-gray-300 text-gray-700 font-bold py-3 rounded-lg shadow-md transition hover:shadow-lg"
                >
                  Clear
                </button>
              </div>
            </div>

            <div className="bg-white p-6 rounded-xl shadow-lg border-2 border-gray-200">
              <h3 className="text-yellow-700 text-sm font-bold uppercase tracking-wider mb-4 flex items-center gap-2">
                <span className="bg-yellow-100 p-2 rounded"><Trophy size={16} /></span> Award Points
              </h3>
              <div className="bg-yellow-50 border-2 border-yellow-300 p-4 rounded-lg mb-4 text-sm text-yellow-900">
                <strong>Steals:</strong> click the answer the stealing team gave to add it to the pot, then award the round to them.
              </div>
              <div className="grid grid-cols-2 gap-3 mb-4">
                <button
                  onClick={() => performAction('AWARD_ROUND', { team: 'team1' })}
                  className="bg-blue-500 hover:bg-blue-600 text-white py-3 rounded-lg font-bold border-2 border-blue-400 shadow-md transition hover:shadow-lg"
                >
                  Award Team 1
                </button>
                <button
                  onClick={() => performAction('AWARD_ROUND', { team: 'team2' })}
                  className="bg-blue-500 hover:bg-blue-600 text-white py-3 rounded-lg font-bold border-2 border-blue-400 shadow-md transition hover:shadow-lg"
                >
                  Award Team 2
                </button>
              </div>
              <button
                onClick={() => performAction('NEXT_ROUND')}
                className="w-full bg-gradient-to-r from-yellow-400 to-yellow-500 hover:from-yellow-500 hover:to-yellow-600 text-yellow-900 font-bold py-4 rounded-lg shadow-lg flex items-center justify-center gap-2 transition transform active:scale-95 hover:shadow-xl text-lg"
              >
                {gameState.currentRoundIndex < rounds.length - 1 ? 'Start Next Round' : 'End Game'} <Play size={20} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
