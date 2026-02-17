"use client";
import { useState, useEffect, useRef } from 'react';
import { Settings, Monitor, Trophy, Copy, Edit2, Save, Plus, X as XIcon, Play, Music, Zap, Lightbulb, Eye } from 'lucide-react';
import confetti from 'canvas-confetti';
import { db } from '@/lib/firebase';
import { ref, onValue, set, update, get } from 'firebase/database';
import { INITIAL_ROUNDS, FAST_MONEY_QUESTIONS, type Round, type FastMoneyQuestion } from '@/lib/gameData';
import { nanoid } from 'nanoid';
import { QRCodeSVG } from 'qrcode.react';

class AudioManager {
  private sounds: Map<string, HTMLAudioElement> = new Map();
  private themeMusic: HTMLAudioElement | null = null;
  private muted: boolean = false;

  constructor() {
    if (typeof window !== 'undefined') {
      this.sounds.set('strike', new Audio('/sounds/strike.mp3'));
      this.sounds.set('reveal', new Audio('/sounds/reveal.mp3'));
      this.sounds.set('win', new Audio('/sounds/win.mp3'));

      this.themeMusic = new Audio('/sounds/theme.mp3');
      this.themeMusic.loop = false;
      this.themeMusic.volume = 0.3;
    }
  }

  play(sound: string, isHost: boolean = false) {
    if (this.muted || isHost) return;
    const audio = this.sounds.get(sound);
    if (audio) {
      audio.currentTime = 0;
      audio.play().catch(() => {});
    }
  }

  startTheme(onEnd?: () => void) {
    if (this.muted || !this.themeMusic) return;

    if (onEnd) {
      this.themeMusic.onended = onEnd;
    }

    this.themeMusic.play().catch(() => {});
  }

  isThemePlaying() {
    return this.themeMusic ? !this.themeMusic.paused : false;
  }

  stopTheme() {
    if (this.themeMusic) {
      this.themeMusic.pause();
      this.themeMusic.currentTime = 0;
    }
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.muted) {
      this.stopTheme();
    }
    return this.muted;
  }

  getMuted() {
    return this.muted;
  }
}

const audioManager = new AudioManager();

const StrikeOverlay = ({ count, lastStrikeTime, isHost }: { count: number, lastStrikeTime: number, isHost?: boolean }) => {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const isRecent = Date.now() - lastStrikeTime < 2000;
    if (count > 0 && isRecent) {
      setVisible(true);
      audioManager.play('strike', isHost);
      const timer = setTimeout(() => setVisible(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [count, lastStrikeTime, isHost]);

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
  const [view, setView] = useState<'landing' | 'host' | 'board' | 'fastmoney'>('landing');
  const [gameState, setGameState] = useState<any>(null);
  const [sessionCode, setSessionCode] = useState('');
  const [inputCode, setInputCode] = useState('');
  const [hostCode, setHostCode] = useState('');
  const [isHost, setIsHost] = useState(false);
  const [editingQuestions, setEditingQuestions] = useState(false);
  const [editedRounds, setEditedRounds] = useState<Round[]>([]);
  const [editedFastMoneyQuestions, setEditedFastMoneyQuestions] = useState<FastMoneyQuestion[]>([]);
  const [muted, setMuted] = useState(false);
  const [showFastMoneyOption, setShowFastMoneyOption] = useState(false);
  const [themeIsPlaying, setThemeIsPlaying] = useState(false);
  const [qrFullscreen, setQrFullscreen] = useState(false);
  const [fmTimeRemaining, setFmTimeRemaining] = useState<number>(45000);
  const fmTimeUpFiredRef = useRef(false);

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

  const fmAllAnswered = (() => {
    const fm = gameState?.fastMoney;
    if (!fm) return false;
    return fm[fm.currentTeam]?.questions?.every((q: any) => q.revealed) ?? false;
  })();

  useEffect(() => {
    const fm = gameState?.fastMoney;
    if (!fm?.timerStartedAt || !fm?.timerDuration) return;
    if (fm.team1?.completed && fm.team2?.completed) return;
    if (fmAllAnswered) return;

    // new turn, so let time-up fire again
    fmTimeUpFiredRef.current = false;

    const interval = setInterval(() => {
      const elapsed = Date.now() - fm.timerStartedAt;
      const remaining = Math.max(0, fm.timerDuration - elapsed);
      setFmTimeRemaining(remaining);
      if (remaining === 0) clearInterval(interval);
    }, 100);

    return () => clearInterval(interval);
  }, [gameState?.fastMoney?.timerStartedAt, gameState?.fastMoney?.currentTeam, fmAllAnswered]);

  // only the host writes time-up, otherwise every screen would
  useEffect(() => {
    if (fmTimeRemaining > 0) return;
    if (!isHost) return;
    if (fmTimeUpFiredRef.current) return;
    const fm = gameState?.fastMoney;
    if (!fm) return;
    const currentTeam = fm.currentTeam;
    const teamData = fm[currentTeam];
    if (!teamData || teamData.completed) return;
    const hasUnrevealed = teamData.questions?.some((q: any) => !q.revealed);
    if (hasUnrevealed) {
      fmTimeUpFiredRef.current = true;
      performAction('FAST_MONEY_TIME_UP');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fmTimeRemaining]);

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
        fastMoneyMode: false,
      },
      rounds: INITIAL_ROUNDS,
      fastMoneyQuestions: FAST_MONEY_QUESTIONS,
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
    let previousRounds: any = null;

    const unsubGame = onValue(gameRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        if (data.winner && !previousGameState?.winner && view === 'board') {
          confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
          audioManager.startTheme();
        }

        if (previousGameState && data.currentRoundIndex > previousGameState.currentRoundIndex && !isHost && view === 'board') {
          audioManager.play('win', isHost);
        }

        if (previousGameState && data.fastMoneyMode && data.fastMoney && previousGameState.fastMoney && !isHost && view === 'board') {
          const currentTeam = data.fastMoney.currentTeam;
          const prevTeamData = previousGameState.fastMoney[currentTeam];
          const newTeamData = data.fastMoney[currentTeam];

          if (prevTeamData && newTeamData && prevTeamData.questions && newTeamData.questions) {
            const newlyRevealed = newTeamData.questions.find((q: any, idx: number) =>
              q.revealed && !prevTeamData.questions[idx]?.revealed
            );

            if (newlyRevealed) {
              if (newlyRevealed.playerPoints > 0) {
                audioManager.play('reveal', isHost);
              } else {
                audioManager.play('strike', isHost);
              }
            }
          }
        }

        previousGameState = data;
        setGameState(data);

        if (data.currentRoundIndex === 2 && !data.fastMoneyMode) {
          setShowFastMoneyOption(true);
        }
      }
    });

    const unsubRounds = onValue(roundsRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        if (previousRounds && previousRounds.length > 0 && !isHost && view === 'board') {
          const currentRoundIndex = previousGameState?.currentRoundIndex || 0;
          const prevRound = previousRounds[currentRoundIndex];
          const newRound = data[currentRoundIndex];
          if (prevRound && newRound) {
            const newlyRevealed = newRound.answers.some((ans: any, idx: number) =>
              ans.revealed && !prevRound.answers[idx]?.revealed
            );
            if (newlyRevealed) {
              audioManager.play('reveal', isHost);
            }
          }
        }
        // don't overwrite the editor while the host is typing
        if (!editingQuestions) {
          previousRounds = data;
          setEditedRounds(data);
        }
      }
    });

    return () => {
      unsubGame();
      unsubRounds();
    };
  }, [view, sessionCode, isHost, editingQuestions]);

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
        fastMoneyMode: false,
      },
      [`sessions/${sessionCode}/rounds`]: INITIAL_ROUNDS,
      [`sessions/${sessionCode}/fastMoneyQuestions`]: FAST_MONEY_QUESTIONS,
    });
    setShowFastMoneyOption(false);
  };

  const openQuestionEditor = async () => {
    if (!sessionCode) return;

    const roundsRef = ref(db, `sessions/${sessionCode}/rounds`);
    const fastMoneyRef = ref(db, `sessions/${sessionCode}/fastMoneyQuestions`);

    const roundsSnapshot = await get(roundsRef);
    if (roundsSnapshot.exists()) {
      const rounds = JSON.parse(JSON.stringify(roundsSnapshot.val()));
      setEditedRounds(rounds);
    }

    const fastMoneySnapshot = await get(fastMoneyRef);
    if (fastMoneySnapshot.exists()) {
      const fastMoneyQuestions = JSON.parse(JSON.stringify(fastMoneySnapshot.val()));
      setEditedFastMoneyQuestions(fastMoneyQuestions);
    } else {
      setEditedFastMoneyQuestions(FAST_MONEY_QUESTIONS);
    }

    setEditingQuestions(true);
  };

  const saveQuestions = async () => {
    if (!sessionCode || !editedRounds.length || !editedFastMoneyQuestions.length) return;

    try {
      await update(ref(db), {
        [`sessions/${sessionCode}/rounds`]: editedRounds,
        [`sessions/${sessionCode}/fastMoneyQuestions`]: editedFastMoneyQuestions,
      });
      setEditingQuestions(false);
      alert('Questions saved successfully!');
    } catch (error) {
      console.error('Error saving questions:', error);
      alert('Failed to save questions. Please try again.');
    }
  };

  const performAction = (action: string, payload: any = {}) => {
    if (!gameState || !sessionCode) return;
    const updates: any = {};
    const currentRound = editedRounds[gameState.currentRoundIndex];

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
        editedRounds[gameState.currentRoundIndex].answers.forEach((_: any, idx: number) => {
          updates[`sessions/${sessionCode}/rounds/${gameState.currentRoundIndex}/answers/${idx}/revealed`] = true;
        });
        break;

      case 'NEXT_ROUND':
        if (gameState.currentRoundIndex < editedRounds.length - 1) {
          updates[`sessions/${sessionCode}/gameState/currentRoundIndex`] = gameState.currentRoundIndex + 1;
          updates[`sessions/${sessionCode}/gameState/roundPoints`] = 0;
          updates[`sessions/${sessionCode}/gameState/strikes`] = 0;
        } else {
          const winner = gameState.scores.team1 > gameState.scores.team2 ? "Team 1" : "Team 2";
          updates[`sessions/${sessionCode}/gameState/winner`] = gameState.scores.team1 === gameState.scores.team2 ? "Draw" : winner;
        }
        break;

      case 'START_FAST_MONEY':
        // team that won the main game goes first
        const winningTeam = gameState.scores.team1 > gameState.scores.team2 ? 'team1' : 'team2';
        const losingTeam = winningTeam === 'team1' ? 'team2' : 'team1';

        const sessionFastMoneyQuestions = payload.fastMoneyQuestions || FAST_MONEY_QUESTIONS;

        const shuffleFMQuestions = (qs: any[]) => {
          const arr = [...qs];
          for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
          }
          return arr;
        };
        const team1Questions = shuffleFMQuestions(sessionFastMoneyQuestions);
        const team2Questions = shuffleFMQuestions(sessionFastMoneyQuestions);

        updates[`sessions/${sessionCode}/gameState/fastMoneyMode`] = true;
        updates[`sessions/${sessionCode}/gameState/fastMoney`] = {
          currentTeam: winningTeam,
          winningTeam: winningTeam,
          losingTeam: losingTeam,
          currentQuestionIndex: 0,
          timerStartedAt: Date.now(),
          timerDuration: 45000,
          team1: {
            totalPoints: 0,
            completed: false,
            questions: team1Questions.map((q: any) => ({
              ...q,
              playerAnswer: '',
              playerPoints: 0,
              revealed: false,
            })),
          },
          team2: {
            totalPoints: 0,
            completed: false,
            questions: team2Questions.map((q: any) => ({
              ...q,
              playerAnswer: '',
              playerPoints: 0,
              revealed: false,
            })),
          },
          finalWinner: null,
        };
        setView('fastmoney');
        break;

      case 'FAST_MONEY_REVEAL':
        const currentTeam = gameState.fastMoney.currentTeam;
        const teamData = gameState.fastMoney[currentTeam];
        const fmQuestion = teamData.questions[payload.index];

        if (!fmQuestion.revealed) {
          updates[`sessions/${sessionCode}/gameState/fastMoney/${currentTeam}/questions/${payload.index}/revealed`] = true;
          updates[`sessions/${sessionCode}/gameState/fastMoney/${currentTeam}/questions/${payload.index}/playerAnswer`] = payload.answer || 'No Answer';
          updates[`sessions/${sessionCode}/gameState/fastMoney/${currentTeam}/questions/${payload.index}/playerPoints`] = payload.points || 0;
          updates[`sessions/${sessionCode}/gameState/fastMoney/${currentTeam}/totalPoints`] = teamData.totalPoints + (payload.points || 0);
          if (payload.index < teamData.questions.length - 1) {
            updates[`sessions/${sessionCode}/gameState/fastMoney/currentQuestionIndex`] = payload.index + 1;
          }
        }
        break;

      case 'FAST_MONEY_SWITCH_TEAM':
        const completingTeam = gameState.fastMoney.currentTeam;
        updates[`sessions/${sessionCode}/gameState/fastMoney/${completingTeam}/completed`] = true;

        const nextTeam = completingTeam === 'team1' ? 'team2' : 'team1';
        updates[`sessions/${sessionCode}/gameState/fastMoney/currentTeam`] = nextTeam;
        updates[`sessions/${sessionCode}/gameState/fastMoney/currentQuestionIndex`] = 0;
        updates[`sessions/${sessionCode}/gameState/fastMoney/timerStartedAt`] = Date.now();
        updates[`sessions/${sessionCode}/gameState/fastMoney/timerDuration`] = 30000;
        break;

      case 'FAST_MONEY_FINISH':
        const currentFMTeam = gameState.fastMoney.currentTeam;
        updates[`sessions/${sessionCode}/gameState/fastMoney/${currentFMTeam}/completed`] = true;

        const team1Total = gameState.fastMoney.team1.totalPoints;
        const team2Total = gameState.fastMoney.team2.totalPoints;
        const fastMoneyWinner = team1Total > team2Total ? 'team1' : team2Total > team1Total ? 'team2' : 'tie';

        updates[`sessions/${sessionCode}/gameState/fastMoney/finalWinner`] = fastMoneyWinner;
        updates[`sessions/${sessionCode}/gameState/winner`] = fastMoneyWinner === 'tie' ? 'Draw' : (fastMoneyWinner === 'team1' ? 'Team 1' : 'Team 2');
        break;

      case 'FAST_MONEY_TIME_UP': {
        const timeUpTeam = gameState.fastMoney.currentTeam;
        const timeUpTeamData = gameState.fastMoney[timeUpTeam];

        const isWinningTeam = timeUpTeam === gameState.fastMoney.winningTeam;
        timeUpTeamData.questions.forEach((q: any, idx: number) => {
          if (!q.revealed) {
            updates[`sessions/${sessionCode}/gameState/fastMoney/${timeUpTeam}/questions/${idx}/revealed`] = true;
            updates[`sessions/${sessionCode}/gameState/fastMoney/${timeUpTeam}/questions/${idx}/playerAnswer`] = 'No Answer / Pass';
            updates[`sessions/${sessionCode}/gameState/fastMoney/${timeUpTeam}/questions/${idx}/playerPoints`] = 0;
            if (isWinningTeam) {
              // keep these blurred so the second team can't read ahead
              updates[`sessions/${sessionCode}/gameState/fastMoney/${timeUpTeam}/questions/${idx}/timedOut`] = true;
            }
          }
        });
        updates[`sessions/${sessionCode}/gameState/fastMoney/${timeUpTeam}/completed`] = true;
        break;
      }
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

  const toggleMute = () => {
    const newMuted = audioManager.toggleMute();
    setMuted(newMuted);
  };

  useEffect(() => {
    if (view !== 'landing') {
      audioManager.stopTheme();
    }
  }, [view]);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && qrFullscreen) {
        setQrFullscreen(false);
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [qrFullscreen]);

  useEffect(() => {
    if (
      gameState?.fastMoneyMode &&
      gameState?.fastMoney?.finalWinner &&
      view === 'fastmoney' &&
      !isHost
    ) {
      confetti({ particleCount: 200, spread: 90, origin: { y: 0.6 } });
      audioManager.startTheme();
    }
  }, [gameState?.fastMoney?.finalWinner, view, isHost]);

  const playThemeMusic = () => {
    if (audioManager.isThemePlaying()) return;

    setThemeIsPlaying(true);
    audioManager.startTheme(() => {
      setThemeIsPlaying(false);
    });
  };

  // Landing Page
  if (view === 'landing') {
    return (
      <div className="min-h-screen bg-blue-950 flex flex-col items-center justify-center text-white font-sans p-4 relative">
        <button
          onClick={playThemeMusic}
          disabled={themeIsPlaying}
          className={`absolute top-4 right-4 p-3 rounded-full border-2 transition-all ${
            themeIsPlaying
              ? 'bg-blue-800/50 border-blue-700 text-blue-500 cursor-not-allowed opacity-60'
              : 'bg-yellow-500 border-yellow-400 text-blue-900 hover:bg-yellow-400 hover:scale-110'
          }`}
          title={themeIsPlaying ? 'Theme music playing...' : 'Play theme music'}
        >
          <Music size={24} className={themeIsPlaying ? 'animate-pulse' : ''} />
        </button>

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

  if (!gameState || !editedRounds.length) {
    return (
      <div className="text-white bg-blue-950 h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-yellow-400 mx-auto mb-4"></div>
          <p>Connecting to Game...</p>
        </div>
      </div>
    );
  }

  const currentRound = editedRounds[gameState.currentRoundIndex];

  // Fast Money View
  if (view === 'fastmoney' || gameState.fastMoneyMode) {
    const fastMoney = gameState.fastMoney;

    if (!fastMoney) {
      return (
        <div className="min-h-screen bg-blue-950 flex items-center justify-center text-white">
          <div className="text-center">
            <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-yellow-400 mx-auto mb-4"></div>
            <p>Loading Fast Money...</p>
          </div>
        </div>
      );
    }

    const currentTeam = fastMoney.currentTeam;
    const currentTeamData = fastMoney[currentTeam];
    const currentQ = currentTeamData.questions[fastMoney.currentQuestionIndex];
    const allRevealed = currentTeamData.questions.every((q: any) => q.revealed);
    const bothTeamsComplete = fastMoney.team1.completed && fastMoney.team2.completed;

    // second team can't give the same answer as the first
    const winningTeam = fastMoney.winningTeam;
    const losingTeam = fastMoney.losingTeam;
    const firstTeamAnswer = currentTeam === losingTeam
      ? fastMoney[winningTeam].questions.find((q: any) => q.question === currentQ.question)?.playerAnswer
      : null;

    // Host View
    if (isHost) {
      return (
        <div className="min-h-screen bg-gray-50 p-4 md:p-6 font-sans text-gray-900">
          <div className="max-w-6xl mx-auto space-y-6">
            <div className="bg-gradient-to-r from-purple-600 to-purple-700 text-white p-6 rounded-xl shadow-xl">
              <div className="flex justify-between items-center">
                <h1 className="text-3xl font-bold flex items-center gap-3">
                  <Zap size={36} className="fill-current" /> FAST MONEY
                </h1>
                <div className="text-sm opacity-90">
                  {fastMoney.winningTeam === 'team1' ? 'Team 1' : 'Team 2'} goes first (won regular rounds)
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className={`p-6 rounded-xl shadow-lg border-4 transition-all ${
                currentTeam === 'team1'
                  ? 'bg-blue-600 text-white border-blue-400'
                  : 'bg-white text-gray-900 border-gray-300'
              }`}>
                <div className="text-center">
                  <h2 className="text-2xl font-bold mb-2">TEAM 1</h2>
                  <div className="text-6xl font-black">{fastMoney.team1.totalPoints}</div>
                  <div className="text-sm mt-2 opacity-75">
                    {fastMoney.team1.completed ? '✓ Complete' : currentTeam === 'team1' ? '▶ Playing' : 'Waiting...'}
                  </div>
                </div>
              </div>
              <div className={`p-6 rounded-xl shadow-lg border-4 transition-all ${
                currentTeam === 'team2'
                  ? 'bg-blue-600 text-white border-blue-400'
                  : 'bg-white text-gray-900 border-gray-300'
              }`}>
                <div className="text-center">
                  <h2 className="text-2xl font-bold mb-2">TEAM 2</h2>
                  <div className="text-6xl font-black">{fastMoney.team2.totalPoints}</div>
                  <div className="text-sm mt-2 opacity-75">
                    {fastMoney.team2.completed ? '✓ Complete' : currentTeam === 'team2' ? '▶ Playing' : 'Waiting...'}
                  </div>
                </div>
              </div>
            </div>

            {!bothTeamsComplete && !allRevealed && (() => {
              const totalMs = fastMoney.timerDuration || 45000;
              const secsLeft = Math.ceil(fmTimeRemaining / 1000);
              const pct = Math.min(100, (fmTimeRemaining / totalMs) * 100);
              const urgent = secsLeft <= 5;
              const warn = secsLeft <= 10;
              return (
                <div className={`p-4 rounded-xl shadow-lg border-4 text-center ${urgent ? 'border-red-500 bg-red-50' : warn ? 'border-yellow-400 bg-yellow-50' : 'border-green-400 bg-green-50'}`}>
                  <div className={`text-6xl font-black mb-2 ${urgent ? 'text-red-600 animate-pulse' : warn ? 'text-yellow-600' : 'text-green-700'}`}>
                    {secsLeft}s
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-4 overflow-hidden">
                    <div
                      className={`h-4 rounded-full transition-all duration-100 ${urgent ? 'bg-red-500' : warn ? 'bg-yellow-400' : 'bg-green-500'}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="text-sm mt-2 font-semibold text-gray-600">
                    {currentTeam === fastMoney.winningTeam ? '45s round' : '30s round'}
                  </div>
                </div>
              );
            })()}

            <div className="bg-white p-6 rounded-xl shadow-lg border-2 border-purple-200">
              <h3 className="text-xl font-bold mb-4 text-purple-900">
                {currentTeam === 'team1' ? 'Team 1' : 'Team 2'} Questions
              </h3>
              <div className="space-y-3">
                {currentTeamData.questions.map((q: any, idx: number) => (
                  <div
                    key={idx}
                    className={`p-4 rounded-lg border-2 ${
                      idx === fastMoney.currentQuestionIndex
                        ? 'border-purple-500 bg-purple-50'
                        : q.revealed
                        ? 'border-green-300 bg-green-50'
                        : 'border-gray-200 bg-white'
                    }`}
                  >
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex-1">
                        <span className="font-bold text-gray-500 mr-2">Q{idx + 1}:</span>
                        <span className="font-semibold">{q.question}</span>
                      </div>
                      {q.revealed && (
                        <span className="text-green-600 font-bold ml-2">{q.playerPoints} pts</span>
                      )}
                    </div>
                    {q.revealed && (
                      <div className="text-sm text-gray-600 mt-2">
                        <div>
                          <strong>Answer:</strong> {q.playerAnswer}
                        </div>
                        <div className="text-xs text-gray-500 mt-1">
                          <strong>All Answers:</strong> {q.answers.map((a: any) => `${a.text} (${a.score})`).join(', ')}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {!allRevealed && (
              <div className="bg-white p-6 rounded-xl shadow-lg border-2 border-blue-200">
                <h3 className="text-xl font-bold mb-4 text-blue-900">
                  Current Question {fastMoney.currentQuestionIndex + 1} of {currentTeamData.questions.length}
                </h3>
                <div className="bg-blue-50 p-4 rounded-lg mb-4 border-2 border-blue-200">
                  <p className="text-2xl font-bold text-blue-900">{currentQ.question}</p>
                </div>

                {!currentQ.revealed && (
                  <div className="space-y-4">
                    <p className="text-sm font-semibold text-gray-700 mb-2">Select the answer the player gave:</p>
                    {currentTeam === losingTeam && firstTeamAnswer && (
                      <p className="text-xs text-red-600 font-semibold">
                        First team answered: {firstTeamAnswer} (disabled below)
                      </p>
                    )}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {currentQ.answers.map((answer: any, idx: number) => {
                        const isDisabled = firstTeamAnswer === answer.text;
                        return (
                          <button
                            key={idx}
                            onClick={() => !isDisabled && performAction('FAST_MONEY_REVEAL', {
                              index: fastMoney.currentQuestionIndex,
                              answer: answer.text,
                              points: answer.score,
                            })}
                            disabled={isDisabled}
                            className={`${
                              isDisabled
                                ? 'bg-gray-400 cursor-not-allowed opacity-50'
                                : idx === 0
                                ? 'bg-green-600 hover:bg-green-700'
                                : 'bg-blue-600 hover:bg-blue-700'
                            } text-white font-bold py-3 px-4 rounded-lg shadow-md transition text-left`}
                          >
                            <div className="flex justify-between items-center">
                              <span className={isDisabled ? 'line-through' : ''}>{answer.text}</span>
                              <span className="ml-2 bg-white bg-opacity-20 px-2 py-1 rounded text-sm">
                                {answer.score} pts
                              </span>
                            </div>
                          </button>
                        );
                      })}
                      <button
                        onClick={() => performAction('FAST_MONEY_REVEAL', {
                          index: fastMoney.currentQuestionIndex,
                          answer: 'No Answer / Pass',
                          points: 0,
                        })}
                        className="bg-gray-500 hover:bg-gray-600 text-white font-bold py-3 px-4 rounded-lg shadow-md transition"
                      >
                        No Answer / Pass (0 pts)
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {allRevealed && !bothTeamsComplete && (
              <div className="bg-gradient-to-r from-blue-600 to-blue-700 p-8 rounded-xl shadow-xl text-white text-center">
                <h2 className="text-2xl font-black mb-4">
                  {currentTeam === 'team1' ? 'Team 1' : 'Team 2'} Completed!
                </h2>
                <div className="text-5xl font-black mb-6">
                  {currentTeamData.totalPoints} Points
                </div>
                <button
                  onClick={() => performAction('FAST_MONEY_SWITCH_TEAM')}
                  className="px-8 py-4 bg-yellow-400 hover:bg-yellow-500 text-blue-900 rounded-xl font-bold text-lg shadow-lg transition"
                >
                  Switch to {currentTeam === 'team1' ? 'Team 2' : 'Team 1'} →
                </button>
              </div>
            )}

            {bothTeamsComplete && !fastMoney.finalWinner && (
              <div className="bg-white p-8 rounded-xl shadow-xl border-4 border-purple-300 text-center">
                <h2 className="text-3xl font-black mb-6">Both Teams Complete!</h2>
                <div className="grid grid-cols-2 gap-6 mb-6">
                  <div>
                    <div className="text-2xl font-bold mb-2">Team 1</div>
                    <div className="text-5xl font-black">{fastMoney.team1.totalPoints}</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold mb-2">Team 2</div>
                    <div className="text-5xl font-black">{fastMoney.team2.totalPoints}</div>
                  </div>
                </div>
                <button
                  onClick={() => performAction('FAST_MONEY_FINISH')}
                  className="px-8 py-4 bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 text-white rounded-xl font-bold text-lg shadow-lg transition"
                >
                  Reveal Winner
                </button>
              </div>
            )}

            {fastMoney.finalWinner && (
              <div className="bg-gradient-to-br from-yellow-400 to-yellow-500 p-8 rounded-xl shadow-xl border-4 border-yellow-600 text-center">
                <h2 className="text-4xl font-black mb-4 text-yellow-900">
                  WINNER: {fastMoney.finalWinner === 'team1' ? 'TEAM 1' : fastMoney.finalWinner === 'team2' ? 'TEAM 2' : 'TIE'}
                </h2>
                <div className="grid grid-cols-2 gap-6 mb-6 text-yellow-900">
                  <div className={fastMoney.finalWinner === 'team1' ? 'font-black text-green-700' : ''}>
                    <div className="text-2xl font-bold mb-2">Team 1</div>
                    <div className="text-5xl font-black">{fastMoney.team1.totalPoints}</div>
                  </div>
                  <div className={fastMoney.finalWinner === 'team2' ? 'font-black text-green-700' : ''}>
                    <div className="text-2xl font-bold mb-2">Team 2</div>
                    <div className="text-5xl font-black">{fastMoney.team2.totalPoints}</div>
                  </div>
                </div>
                <p className="text-xl text-yellow-900 mb-6 font-bold">
                  The winner is now up on the board.
                </p>
              </div>
            )}
          </div>
        </div>
      );
    }

    // Board View
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-900 via-purple-950 to-black p-4 md:p-8 flex flex-col text-white font-sans">
        <button
          onClick={toggleMute}
          className={`absolute top-4 right-4 z-20 p-3 rounded-full border-2 transition-all ${
            muted
              ? 'bg-red-600 border-red-500 hover:bg-red-500'
              : 'bg-green-600 border-green-500 hover:bg-green-500'
          }`}
          title={muted ? 'Unmute audio' : 'Mute audio'}
        >
          <Music size={24} className={muted ? 'opacity-50' : 'opacity-100'} />
        </button>

        <div className="mb-6 text-center">
          <h1 className="text-5xl md:text-7xl font-black text-yellow-400 mb-4 drop-shadow-[0_0_30px_rgba(250,204,21,0.5)]">
            FAST MONEY
          </h1>
          <div className="text-xl text-yellow-200 mb-4">
            {currentTeam === 'team1' ? 'TEAM 1' : 'TEAM 2'} Playing Now
          </div>
          {!bothTeamsComplete && !allRevealed && (() => {
            const totalMs = fastMoney.timerDuration || 45000;
            const secsLeft = Math.ceil(fmTimeRemaining / 1000);
            const pct = Math.min(100, (fmTimeRemaining / totalMs) * 100);
            const urgent = secsLeft <= 5;
            const warn = secsLeft <= 10;
            return (
              <div className="max-w-xs mx-auto">
                <div className={`text-8xl font-black mb-2 drop-shadow-lg ${urgent ? 'text-red-400 animate-pulse' : warn ? 'text-yellow-300' : 'text-green-300'}`}>
                  {secsLeft}s
                </div>
                <div className="w-full bg-white/20 rounded-full h-5 overflow-hidden">
                  <div
                    className={`h-5 rounded-full transition-all duration-100 ${urgent ? 'bg-red-500' : warn ? 'bg-yellow-400' : 'bg-green-400'}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })()}
        </div>

        <div className="grid grid-cols-2 gap-4 mb-6 max-w-4xl mx-auto w-full">
          <div className={`p-4 rounded-xl border-4 transition-all ${
            currentTeam === 'team1'
              ? 'bg-blue-600 border-blue-400 scale-105'
              : 'bg-white/10 border-white/30'
          }`}>
            <div className="text-center">
              <div className="text-xl font-bold mb-1">TEAM 1</div>
              <div className="text-5xl font-black">{fastMoney.team1.totalPoints}</div>
              <div className="text-xs mt-1 opacity-75">
                {fastMoney.team1.completed ? '✓ Complete' : currentTeam === 'team1' ? '▶ Playing' : 'Up Next'}
              </div>
            </div>
          </div>
          <div className={`p-4 rounded-xl border-4 transition-all ${
            currentTeam === 'team2'
              ? 'bg-blue-600 border-blue-400 scale-105'
              : 'bg-white/10 border-white/30'
          }`}>
            <div className="text-center">
              <div className="text-xl font-bold mb-1">TEAM 2</div>
              <div className="text-5xl font-black">{fastMoney.team2.totalPoints}</div>
              <div className="text-xs mt-1 opacity-75">
                {fastMoney.team2.completed ? '✓ Complete' : currentTeam === 'team2' ? '▶ Playing' : 'Up Next'}
              </div>
            </div>
          </div>
        </div>

        {!bothTeamsComplete && (
          <div className="w-full max-w-5xl mx-auto space-y-3">
            {currentTeamData.questions.map((q: any, idx: number) => {
              const isActive = idx === fastMoney.currentQuestionIndex && !q.revealed;
              const isFuture = idx > fastMoney.currentQuestionIndex && !q.revealed;
              const blurQuestion = q.timedOut === true;
              return (
              <div
                key={idx}
                className={`transition-all duration-500 ${isFuture ? 'opacity-50 scale-95' : 'opacity-100 scale-100'}`}
              >
                <div className={`bg-gradient-to-r from-purple-700 to-purple-800 rounded-xl border-2 shadow-xl transition-all duration-300 ${
                  isActive ? 'p-5 border-yellow-400 shadow-yellow-400/30' : 'p-4 border-purple-500'
                }`}>
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3 flex-1">
                      <span className={`font-black flex items-center justify-center flex-shrink-0 rounded-full transition-all duration-300 ${
                        isActive
                          ? 'bg-yellow-400 text-purple-900 text-2xl w-11 h-11'
                          : 'bg-purple-900 text-yellow-400 text-xl w-9 h-9'
                      }`}>
                        {idx + 1}
                      </span>
                      <span className={`font-bold transition-all duration-300 ${
                        isActive ? 'text-2xl md:text-3xl' : 'text-lg md:text-xl'
                      } ${(isFuture || blurQuestion) ? 'blur-md select-none' : ''}`}>
                        {q.question}
                      </span>
                    </div>
                    {q.revealed && (
                      <div className="flex items-center gap-3">
                        {q.playerAnswer === 'No Answer / Pass' ? (
                          <XIcon size={48} strokeWidth={3} className="text-red-500 mr-3" />
                        ) : (
                          <div className="text-sm text-yellow-300 font-semibold mr-3">{q.playerAnswer}</div>
                        )}
                        <div className="bg-yellow-400 text-purple-900 font-black text-3xl px-4 py-2 rounded-lg shadow-lg">
                          {q.playerPoints}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              );
            })}
          </div>
        )}

        {bothTeamsComplete && (() => {
          // questions are shuffled per team, so line rows up by question
          const winningQs: any[] = fastMoney[winningTeam].questions;
          const losingQs: any[] = winningQs.map((wq: any) =>
            fastMoney[losingTeam].questions.find((lq: any) => lq.question === wq.question)
          ).filter(Boolean);
          const team1DisplayQs = winningTeam === 'team1' ? winningQs : losingQs;
          const team2DisplayQs = winningTeam === 'team2' ? winningQs : losingQs;
          return (
          <div className="w-full max-w-6xl mx-auto">
            <div className="grid grid-cols-2 gap-6">
              <div className="space-y-2">
                <h3 className="text-2xl font-black text-center mb-3 text-blue-300">TEAM 1</h3>
                {team1DisplayQs.map((q: any, idx: number) => (
                  <div key={idx} className="bg-blue-900/50 p-3 rounded-lg border border-blue-700">
                    <div className="flex justify-between items-center">
                      <div className="flex-1">
                        <div className="text-sm font-bold">{q.question}</div>
                        <div className="text-xs text-blue-300">
                          {q.playerAnswer === 'No Answer / Pass' ? 'No Answer' : q.playerAnswer}
                        </div>
                        <div className="text-xs text-gray-400 mt-1">Top: {q.answers[0].text} ({q.answers[0].score})</div>
                      </div>
                      <div className="text-2xl font-black text-yellow-400">{q.playerPoints}</div>
                    </div>
                  </div>
                ))}
                <div className="bg-blue-600 p-4 rounded-xl text-center border-2 border-blue-400">
                  <div className="text-sm">Total</div>
                  <div className="text-5xl font-black">{fastMoney.team1.totalPoints}</div>
                </div>
              </div>

              <div className="space-y-2">
                <h3 className="text-2xl font-black text-center mb-3 text-red-300">TEAM 2</h3>
                {team2DisplayQs.map((q: any, idx: number) => (
                  <div key={idx} className="bg-red-900/50 p-3 rounded-lg border border-red-700">
                    <div className="flex justify-between items-center">
                      <div className="flex-1">
                        <div className="text-sm font-bold">{q.question}</div>
                        <div className="text-xs text-red-300">
                          {q.playerAnswer === 'No Answer / Pass' ? 'No Answer' : q.playerAnswer}
                        </div>
                        <div className="text-xs text-gray-400 mt-1">Top: {q.answers[0].text} ({q.answers[0].score})</div>
                      </div>
                      <div className="text-2xl font-black text-yellow-400">{q.playerPoints}</div>
                    </div>
                  </div>
                ))}
                <div className="bg-red-600 p-4 rounded-xl text-center border-2 border-red-400">
                  <div className="text-sm">Total</div>
                  <div className="text-5xl font-black">{fastMoney.team2.totalPoints}</div>
                </div>
              </div>
            </div>

            {fastMoney.finalWinner && (
              <div className="mt-8 text-center">
                <div className="animate-bounce">
                  <Trophy size={96} className="mx-auto mb-4 text-yellow-400" />
                  <div className="text-6xl font-black text-yellow-400 drop-shadow-[0_0_30px_rgba(250,204,21,0.8)]">
                    {fastMoney.finalWinner === 'team1' ? 'TEAM 1 WINS!' : fastMoney.finalWinner === 'team2' ? 'TEAM 2 WINS!' : 'IT\'S A TIE!'}
                  </div>
                  <div className="text-3xl mt-4 text-yellow-200">
                    {fastMoney.team1.totalPoints} - {fastMoney.team2.totalPoints}
                  </div>
                </div>
              </div>
            )}
          </div>
          );
        })()}
      </div>
    );
  }

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
        <StrikeOverlay count={gameState.strikes} lastStrikeTime={gameState.lastStrikeTime} isHost={isHost} />

        <button
          onClick={toggleMute}
          className={`absolute top-4 right-4 z-20 p-3 rounded-full border-2 transition-all ${
            muted
              ? 'bg-red-600 border-red-500 hover:bg-red-500'
              : 'bg-green-600 border-green-500 hover:bg-green-500'
          }`}
          title={muted ? 'Unmute audio' : 'Mute audio'}
        >
          <Music size={24} className={muted ? 'opacity-50' : 'opacity-100'} />
        </button>

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
              Round {gameState.currentRoundIndex + 1} / {editedRounds.length}
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

        <div
          className="bg-white p-6 rounded-xl shadow-lg text-center cursor-pointer hover:shadow-xl transition-all hover:scale-[1.02] border-2 border-blue-200"
          onClick={() => setQrFullscreen(true)}
        >
          <h3 className="text-lg font-bold text-blue-900 mb-3 flex items-center justify-center gap-2">
            <Monitor size={20} /> Scan to Join
          </h3>
          <p className="text-sm text-gray-600 mb-4">Click to enlarge for easy scanning</p>
          <QRCodeSVG
            value={`${typeof window !== 'undefined' ? window.location.origin : ''}?code=${sessionCode}`}
            size={180}
            level="M"
            className="mx-auto border-4 border-gray-200 rounded-lg p-2"
          />
        </div>

        {qrFullscreen && (
          <div
            className="fixed inset-0 z-[9999] bg-white flex flex-col items-center justify-center p-8"
            onClick={() => setQrFullscreen(false)}
          >
            <button
              onClick={() => setQrFullscreen(false)}
              className="absolute top-4 right-4 px-4 py-2 bg-red-600 text-white rounded-lg font-bold hover:bg-red-700"
            >
              Close
            </button>
            <h1 className="text-4xl font-bold text-blue-900 mb-8">Scan to Join Game</h1>
            <QRCodeSVG
              value={`${typeof window !== 'undefined' ? window.location.origin : ''}?code=${sessionCode}`}
              size={400}
              level="M"
              className="shadow-2xl"
            />
            <div className="mt-8 bg-yellow-100 px-6 py-3 rounded-lg border-2 border-yellow-400">
              <div className="text-xs text-yellow-700 font-semibold">Session Code</div>
              <div className="font-mono font-bold text-3xl text-yellow-900">{sessionCode}</div>
            </div>
            <p className="mt-4 text-gray-600">Click anywhere to close</p>
          </div>
        )}

        <div className="bg-white p-6 rounded-xl shadow-lg border-2 border-purple-200">
          <button
            onClick={() => editingQuestions ? setEditingQuestions(false) : openQuestionEditor()}
            className="w-full px-6 py-4 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-bold flex items-center justify-center gap-2 transition-colors shadow-md hover:shadow-lg text-lg"
          >
            {editingQuestions ? <XIcon size={24} /> : <Edit2 size={24} />}
            {editingQuestions ? 'Close Question Editor' : 'Edit Questions'}
          </button>
        </div>

        {editingQuestions && (
          <div className="bg-white p-6 rounded-xl shadow-lg border-2 border-purple-300">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-2xl font-bold text-purple-900 flex items-center gap-2">
                <Edit2 size={28} /> Question Editor
              </h3>
              <button
                onClick={() => {
                  const newRound: Round = {
                    title: `Round ${editedRounds.length + 1}`,
                    question: 'Enter your question here',
                    multiplier: 1,
                    hostTip: 'Add a tip for the host',
                    answers: [
                      { text: '', points: 0, revealed: false },
                    ],
                  };
                  setEditedRounds([...editedRounds, newRound]);
                }}
                className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-bold flex items-center gap-2 shadow-md transition"
              >
                <Plus size={20} /> Add Round
              </button>
            </div>
            <div className="space-y-6">
              {editedRounds.map((round, roundIdx) => (
                <div key={roundIdx} className="border-2 border-purple-200 p-5 rounded-xl bg-purple-50/30">
                  <div className="flex justify-between items-start mb-4">
                    <h4 className="font-bold text-xl text-purple-900">Round {roundIdx + 1}</h4>
                    <div className="flex items-center gap-3">
                      <label className="text-sm font-semibold text-gray-700">Multiplier:</label>
                      <select
                        value={round.multiplier}
                        onChange={(e) => {
                          const newRounds = [...editedRounds];
                          newRounds[roundIdx].multiplier = parseInt(e.target.value);
                          setEditedRounds(newRounds);
                        }}
                        className="px-3 py-2 border-2 border-purple-300 rounded-lg font-bold bg-white"
                      >
                        <option value="1">1x</option>
                        <option value="2">2x</option>
                        <option value="3">3x</option>
                      </select>
                      {editedRounds.length > 1 && (
                        <button
                          onClick={() => {
                            const newRounds = [...editedRounds];
                            newRounds.splice(roundIdx, 1);
                            setEditedRounds(newRounds);
                          }}
                          className="px-3 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg font-bold transition"
                          title="Delete Round"
                        >
                          <XIcon size={20} />
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="mb-3">
                    <label className="text-xs font-semibold text-gray-600 uppercase mb-1 block">Host Tip</label>
                    <input
                      type="text"
                      value={round.hostTip || ''}
                      onChange={(e) => {
                        const newRounds = [...editedRounds];
                        newRounds[roundIdx].hostTip = e.target.value;
                        setEditedRounds(newRounds);
                      }}
                      className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg text-sm italic"
                      placeholder="Add a helpful tip for the host..."
                    />
                  </div>
                  <div className="mb-4">
                    <label className="text-xs font-semibold text-gray-600 uppercase mb-1 block">Question</label>
                    <textarea
                      value={round.question}
                      onChange={(e) => {
                        const newRounds = [...editedRounds];
                        newRounds[roundIdx].question = e.target.value;
                        setEditedRounds(newRounds);
                      }}
                      rows={2}
                      className="w-full px-4 py-3 border-2 border-purple-300 rounded-lg font-semibold text-lg resize-none"
                      placeholder="Enter your question here..."
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-gray-600 uppercase mb-2 block">Answers</label>
                    {round.answers.map((answer, ansIdx) => (
                      <div key={ansIdx} className="flex gap-2">
                        <input
                          type="text"
                          value={answer.text}
                          onChange={(e) => {
                            const newRounds = [...editedRounds];
                            newRounds[roundIdx].answers[ansIdx].text = e.target.value;
                            setEditedRounds(newRounds);
                          }}
                          className="flex-grow px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-purple-400 focus:ring-2 focus:ring-purple-200"
                          placeholder={`Answer ${ansIdx + 1}`}
                        />
                        <input
                          type="number"
                          value={answer.points}
                          onChange={(e) => {
                            const newRounds = [...editedRounds];
                            newRounds[roundIdx].answers[ansIdx].points = parseInt(e.target.value) || 0;
                            setEditedRounds(newRounds);
                          }}
                          className="w-24 px-3 py-2 border-2 border-gray-300 rounded-lg text-center font-mono font-bold focus:border-purple-400 focus:ring-2 focus:ring-purple-200"
                          placeholder="Pts"
                          min="0"
                        />
                        <button
                          onClick={() => {
                            const newRounds = [...editedRounds];
                            newRounds[roundIdx].answers.splice(ansIdx, 1);
                            setEditedRounds(newRounds);
                          }}
                          className="px-3 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg transition"
                          title="Delete Answer"
                        >
                          <XIcon size={20} />
                        </button>
                      </div>
                    ))}
                    {round.answers.length < 8 && (
                      <button
                        onClick={() => {
                          const newRounds = [...editedRounds];
                          newRounds[roundIdx].answers.push({ text: '', points: 0, revealed: false });
                          setEditedRounds(newRounds);
                        }}
                        className="w-full px-4 py-3 bg-green-500 hover:bg-green-600 text-white rounded-lg font-semibold flex items-center justify-center gap-2 transition shadow-md"
                      >
                        <Plus size={16} /> Add Answer
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-8 pt-6 border-t-4 border-yellow-400">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-2xl font-bold text-yellow-600 flex items-center gap-2">
                  <Zap size={28} /> Fast Money Questions
                </h3>
              </div>
              <div className="space-y-6">
                {editedFastMoneyQuestions.map((fmQuestion, fmIdx) => (
                  <div key={fmIdx} className="border-2 border-yellow-300 p-5 rounded-xl bg-yellow-50/30">
                    <div className="flex justify-between items-start mb-4">
                      <h4 className="font-bold text-xl text-yellow-700">Question {fmIdx + 1}</h4>
                      {editedFastMoneyQuestions.length > 1 && (
                        <button
                          onClick={() => {
                            const newQuestions = [...editedFastMoneyQuestions];
                            newQuestions.splice(fmIdx, 1);
                            setEditedFastMoneyQuestions(newQuestions);
                          }}
                          className="px-3 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg font-bold transition"
                          title="Delete Question"
                        >
                          <XIcon size={20} />
                        </button>
                      )}
                    </div>

                    <div className="mb-4">
                      <label className="text-xs font-semibold text-gray-600 uppercase mb-1 block">Question</label>
                      <textarea
                        value={fmQuestion.question}
                        onChange={(e) => {
                          const newQuestions = [...editedFastMoneyQuestions];
                          newQuestions[fmIdx].question = e.target.value;
                          setEditedFastMoneyQuestions(newQuestions);
                        }}
                        rows={2}
                        className="w-full px-4 py-3 border-2 border-yellow-300 rounded-lg font-semibold text-lg resize-none"
                        placeholder="Enter your Fast Money question here..."
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs font-semibold text-gray-600 uppercase mb-2 block">Answers (Top to Bottom)</label>
                      {fmQuestion.answers.map((answer, ansIdx) => (
                        <div key={ansIdx} className="flex gap-2 items-center">
                          <span className="text-sm font-bold text-gray-500 w-6">#{ansIdx + 1}</span>
                          <input
                            type="text"
                            value={answer.text}
                            onChange={(e) => {
                              const newQuestions = [...editedFastMoneyQuestions];
                              newQuestions[fmIdx].answers[ansIdx].text = e.target.value;
                              setEditedFastMoneyQuestions(newQuestions);
                            }}
                            className="flex-grow px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-yellow-400 focus:ring-2 focus:ring-yellow-200"
                            placeholder={`Answer ${ansIdx + 1}`}
                          />
                          <input
                            type="number"
                            value={answer.score}
                            onChange={(e) => {
                              const newQuestions = [...editedFastMoneyQuestions];
                              newQuestions[fmIdx].answers[ansIdx].score = parseInt(e.target.value) || 0;
                              setEditedFastMoneyQuestions(newQuestions);
                            }}
                            className="w-24 px-3 py-2 border-2 border-gray-300 rounded-lg text-center font-mono font-bold focus:border-yellow-400 focus:ring-2 focus:ring-yellow-200"
                            placeholder="Score"
                            min="0"
                          />
                          {fmQuestion.answers.length > 1 && (
                            <button
                              onClick={() => {
                                const newQuestions = [...editedFastMoneyQuestions];
                                newQuestions[fmIdx].answers.splice(ansIdx, 1);
                                setEditedFastMoneyQuestions(newQuestions);
                              }}
                              className="px-3 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg transition"
                              title="Delete Answer"
                            >
                              <XIcon size={20} />
                            </button>
                          )}
                        </div>
                      ))}
                      {fmQuestion.answers.length < 8 && (
                        <button
                          onClick={() => {
                            const newQuestions = [...editedFastMoneyQuestions];
                            newQuestions[fmIdx].answers.push({ text: '', score: 0 });
                            setEditedFastMoneyQuestions(newQuestions);
                          }}
                          className="w-full px-4 py-3 bg-green-500 hover:bg-green-600 text-white rounded-lg font-semibold flex items-center justify-center gap-2 transition shadow-md"
                        >
                          <Plus size={16} /> Add Answer
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                <button
                  onClick={() => {
                    const newQuestion: FastMoneyQuestion = {
                      question: 'Enter your Fast Money question here',
                      answers: [
                        { text: '', score: 0 },
                      ],
                    };
                    setEditedFastMoneyQuestions([...editedFastMoneyQuestions, newQuestion]);
                  }}
                  className="w-full px-4 py-3 bg-yellow-500 hover:bg-yellow-600 text-white rounded-lg font-bold flex items-center justify-center gap-2 shadow-md transition"
                >
                  <Plus size={20} /> Add Fast Money Question
                </button>
              </div>
            </div>

            <div className="mt-6 pt-6 border-t-2 border-purple-200">
              <button
                onClick={saveQuestions}
                className="w-full px-6 py-4 bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 text-white rounded-xl font-bold flex items-center justify-center gap-2 shadow-lg hover:shadow-xl transition text-lg"
              >
                <Save size={24} />
                Save All Questions
              </button>
              <p className="text-sm text-gray-600 text-center mt-3">
                Changes will be saved to the session and persist until the game is reset
              </p>
            </div>
          </div>
        )}

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
                {gameState.currentRoundIndex < editedRounds.length - 1 ? 'Start Next Round' : 'End Game'} <Play size={20} />
              </button>
            </div>

            {showFastMoneyOption && gameState.currentRoundIndex === editedRounds.length - 1 && !gameState.winner && (
              <div className="bg-gradient-to-br from-purple-600 to-purple-700 p-6 rounded-xl shadow-xl text-white border-2 border-purple-500">
                <h3 className="text-xl font-bold mb-3 flex items-center gap-2">
                  <Zap size={24} /> Fast Money
                </h3>
                <p className="text-sm mb-4 opacity-90">Optional final round. Both teams play and the higher total wins.</p>
                <button
                  onClick={async () => {
                    // Fetch Fast Money questions from session
                    const fastMoneyRef = ref(db, `sessions/${sessionCode}/fastMoneyQuestions`);
                    const snapshot = await get(fastMoneyRef);
                    const fastMoneyQuestions = snapshot.exists() ? snapshot.val() : FAST_MONEY_QUESTIONS;
                    performAction('START_FAST_MONEY', { fastMoneyQuestions });
                  }}
                  className="w-full bg-yellow-400 hover:bg-yellow-500 text-purple-900 font-bold py-3 rounded-lg shadow-lg flex items-center justify-center gap-2 transition hover:shadow-xl"
                >
                  <Play size={20} />
                  Start Fast Money
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
