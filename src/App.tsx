import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Trophy, RotateCcw, Play, User, Cpu, Users, Mic, MicOff, Copy, Check, LogOut, Info, X, Layers, Settings, Volume2, Hand } from 'lucide-react';
import { io, Socket } from 'socket.io-client';
import { Card, Player, GameState, Suit } from './types';
import { createDeck, shuffleDeck, SUIT_SYMBOLS, SUIT_COLORS, SUITS } from './constants';
import { playSound, playPhrase, setSfxVolume, setPhraseVolume, playThematicPhrase } from './services/soundService';

const INITIAL_PLAYERS: Player[] = [
  { id: 0, name: 'Você', hand: [], isAI: false, team: 0, level: 1 },
  { id: 1, name: 'AI 1', hand: [], isAI: true, team: 1, level: 2 },
  { id: 2, name: 'Parceiro', hand: [], isAI: true, team: 0, level: 3 },
  { id: 3, name: 'AI 2', hand: [], isAI: true, team: 1, level: 4 },
];

const CARD_BACKS_IMAGE = "https://i.ibb.co/v4m0Yv8/card-backs.png"; // Placeholder for the provided image

const CardComponent: React.FC<{
  card: Card;
  onClick?: () => void;
  disabled?: boolean;
  isFaceUp?: boolean;
  className?: string;
  index?: number;
  playerName?: string;
  playerLevel?: number;
  delay?: number;
}> = ({ card, onClick, disabled, isFaceUp = true, className = '', index = 0, playerName, playerLevel = 1, delay = 0 }) => {
  const getCardImageUrl = (card: Card) => {
    const suitMap: Record<Suit, string> = {
      'espadas': 'S',
      'copas': 'H',
      'ouros': 'D',
      'paus': 'C'
    };
    const rankMap: Record<string, string> = {
      'A': 'A',
      'K': 'K',
      'Q': 'Q',
      'J': 'J',
      '7': '7',
      '6': '6'
    };
    return `https://deckofcardsapi.com/static/img/${rankMap[card.rank]}${suitMap[card.suit]}.png`;
  };

  // Calculate background position for the card back sprite sheet (4x4)
  const getCardBackStyle = () => {
    const level = Math.max(1, Math.min(16, playerLevel));
    const row = Math.floor((level - 1) / 4);
    const col = (level - 1) % 4;
    
    return {
      backgroundImage: `url(${CARD_BACKS_IMAGE})`,
      backgroundSize: '400% 400%',
      backgroundPosition: `${col * 33.33}% ${row * 33.33}%`,
    };
  };

  return (
    <motion.div
      layout
      initial={{ scale: 0, opacity: 0, y: -200, rotate: 180 }}
      animate={{ scale: 1, opacity: 1, y: 0, rotate: 0 }}
      transition={{ 
        type: "spring", 
        stiffness: 260, 
        damping: 20,
        delay: delay 
      }}
      exit={{ scale: 0, opacity: 0, y: -50 }}
      whileHover={!disabled && isFaceUp ? { y: -10, scale: 1.05, transition: { delay: 0 } } : {}}
      onClick={!disabled ? onClick : undefined}
      className={`group relative w-20 h-28 sm:w-24 sm:h-36 rounded-lg shadow-xl cursor-pointer flex flex-col items-center justify-center ${
        disabled ? 'opacity-50 cursor-not-allowed' : ''
      } ${className}`}
      style={{
        zIndex: index,
        marginLeft: index > 0 ? '-1.5rem' : '0',
      }}
    >
      {isFaceUp ? (
        <img 
          src={getCardImageUrl(card)} 
          alt={`${card.rank} de ${card.suit}`}
          className="w-full h-full object-contain rounded-lg"
          referrerPolicy="no-referrer"
        />
      ) : (
        <div 
          className="w-full h-full rounded-lg border-2 border-white/20 shadow-inner overflow-hidden bg-moz-red"
          style={getCardBackStyle()}
        >
          {/* Fallback pattern if image fails to load */}
          <div className="w-full h-full opacity-10 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-white via-transparent to-transparent pointer-events-none" />
        </div>
      )}
      
      {playerName && (
        <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-moz-black/90 text-white text-[10px] px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-[100] border border-white/10 font-bold uppercase">
          {playerName} (Nível {playerLevel})
        </div>
      )}
    </motion.div>
  );
};

export default function App() {
  const [gameState, setGameState] = useState<GameState>({
    deck: [],
    players: INITIAL_PLAYERS,
    currentPlayerIndex: 0,
    trumpCard: null,
    tableCards: [],
    scores: { 0: 0, 1: 0, 2: 0, 3: 0 },
    gamePhase: 'dealing',
    collectedCards: { 0: [], 1: [], 2: [], 3: [] },
    lastWinnerId: null,
    winningCardIndex: null,
    previewTrump: null,
    dealerIndex: 3,
    message: '',
    isOnline: false,
    mode: 'partners',
  });

  const [showIntro, setShowIntro] = useState(true);
  const [showRules, setShowRules] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [sfxVol, setSfxVol] = useState(0.5);
  const [phraseVol, setPhraseVol] = useState(0.8);
  const [gameMode, setGameMode] = useState<'partners' | 'individual'>('partners');
  const [showOnlineMenu, setShowOnlineMenu] = useState(false);
  const [roomId, setRoomId] = useState('');
  const [playerName, setPlayerName] = useState('Jogador ' + Math.floor(Math.random() * 1000));
  const [socket, setSocket] = useState<Socket | null>(null);
  const [copied, setCopied] = useState(false);
  const [isMicOn, setIsMicOn] = useState(false);
  const [isDealing, setIsDealing] = useState(false);
  const [dealingTarget, setDealingTarget] = useState<{ x: number, y: number } | null>(null);
  
  const localStream = useRef<MediaStream | null>(null);
  const peerConnections = useRef<Map<string, RTCPeerConnection>>(new Map());
  const remoteStreams = useRef<Map<string, MediaStream>>(new Map());

  const startNewGame = useCallback((isOnline = false, mode: 'partners' | 'individual' = gameMode) => {
    playSound('shuffle');
    setIsDealing(true);
    
    const deck = shuffleDeck(createDeck());
    let players = isOnline ? gameState.players : INITIAL_PLAYERS.map(p => ({ ...p, hand: [] }));
    
    if (mode === 'individual') {
      players = players.map((p, i) => ({ ...p, team: i }));
    } else {
      players = players.map((p, i) => ({ ...p, team: i % 2 }));
    }

    const dealerIndex = (gameState.dealerIndex + 1) % 4;
    
    // Distribute 6 cards to each player with a 5-second sequence
    const totalDealingTime = 5000;
    const cardsPerPlayer = 6;
    const totalCards = 24;
    const timePerCard = totalDealingTime / totalCards;

    // We'll update the hand state gradually
    const tempPlayers = JSON.parse(JSON.stringify(players));
    
    for (let cardIdx = 0; cardIdx < cardsPerPlayer; cardIdx++) {
      for (let playerIdx = 0; playerIdx < 4; playerIdx++) {
        const globalCardIdx = cardIdx * 4 + playerIdx;
        setTimeout(() => {
          playSound('deal');
          // Update target for the hand icon
          const positions = [
            { x: 0, y: 300 },   // Bottom (You)
            { x: -400, y: 0 },  // Left
            { x: 0, y: -300 },  // Top
            { x: 400, y: 0 }    // Right
          ];
          setDealingTarget(positions[playerIdx]);
          
          if (globalCardIdx === totalCards - 1) {
            setTimeout(() => {
              setIsDealing(false);
              setDealingTarget(null);
            }, 500);
          }
        }, globalCardIdx * timePerCard);
      }
    }

    // Set the final hands immediately but they will animate in with delays
    for (let i = 0; i < 4; i++) {
      if (players[i]) {
        players[i].hand = deck.slice(i * 6, (i + 1) * 6);
      }
    }

    const trumpCard = players[dealerIndex]?.hand[5] || deck[23];
    const firstPlayerIndex = (dealerIndex + 1) % 4;

    const initialScores: { [id: string | number]: number } = {};
    const initialCollected: { [id: string | number]: Card[] } = {};
    if (mode === 'individual') {
      players.forEach(p => {
        initialScores[p.id] = 0;
        initialCollected[p.id] = [];
      });
    } else {
      initialScores[0] = 0;
      initialScores[1] = 0;
      initialCollected[0] = [];
      initialCollected[1] = [];
    }

    const newState: GameState = {
      ...gameState,
      deck: deck.slice(24),
      players,
      currentPlayerIndex: dealerIndex, // Dealer selects trump
      trumpCard: null, // Will be set during selection
      tableCards: [],
      scores: initialScores,
      collectedCards: initialCollected,
      gamePhase: 'trumpSelection',
      lastWinnerId: null,
      winningCardIndex: null,
      previewTrump: null,
      dealerIndex,
      message: 'O distribuidor está a escolher o trunfo...',
      isOnline,
      mode,
    };

    setGameState(newState);
    if (isOnline && socket) {
      socket.emit('start-game', { roomId: gameState.roomId, gameState: newState });
    }
  }, [gameState, socket, gameMode]);

  const selectTrump = useCallback((suit: Suit) => {
    playSound('roundEnd'); // Use roundEnd sound for selection
    setGameState(prev => {
      const firstPlayerIndex = (prev.dealerIndex + 1) % 4;
      const newState: GameState = {
        ...prev,
        trumpCard: { suit, rank: 'A', value: 0, strength: 0 }, // Suit is what matters
        gamePhase: 'playing',
        currentPlayerIndex: firstPlayerIndex,
        previewTrump: null,
        message: `Trunfo: ${suit.toUpperCase()}`,
      };
      if (prev.isOnline && socket) {
        socket.emit('play-card', { roomId: prev.roomId, playerId: prev.players[prev.dealerIndex].id, cardIndex: -1, gameState: newState });
      }
      return newState;
    });
  }, [socket]);

  const updateTrumpPreview = useCallback((suit: Suit) => {
    setGameState(prev => {
      if (prev.isOnline && socket) {
        socket.emit('trump-preview', { roomId: prev.roomId, suit });
      }
      return { ...prev, previewTrump: suit };
    });
  }, [socket]);

  const determineTrickWinner = (tableCards: { card: Card; playerId: string | number }[], trumpSuit: Suit) => {
    const leadSuit = tableCards[0].card.suit;
    let winnerIndexInTable = 0;
    let bestCard = tableCards[0].card;

    for (let i = 1; i < tableCards.length; i++) {
      const currentCard = tableCards[i].card;
      if (currentCard.suit === trumpSuit && bestCard.suit !== trumpSuit) {
        winnerIndexInTable = i;
        bestCard = currentCard;
      } else if (currentCard.suit === bestCard.suit) {
        if (currentCard.strength > bestCard.strength) {
          winnerIndexInTable = i;
          bestCard = currentCard;
        }
      }
    }
    return {
      winnerId: tableCards[winnerIndexInTable].playerId,
      winnerIndexInTable
    };
  };

  const playCard = useCallback((playerId: string | number, cardIndex: number) => {
    setGameState(prev => {
      const playerIndex = prev.players.findIndex(p => p.id === playerId);
      if (playerIndex === -1) return prev;

      const player = prev.players[playerIndex];
      const card = player.hand[cardIndex];
      
      // Play card sound
      playSound('play');

      // Special phrases for high trump cards
      if (prev.trumpCard && card.suit === prev.trumpCard.suit) {
        if (card.rank === '7' || card.rank === 'A') {
          playThematicPhrase('highTrump');
        }
      }

      const newHand = [...player.hand];
      newHand.splice(cardIndex, 1);

      const newPlayers = prev.players.map(p => 
        p.id === playerId ? { ...p, hand: newHand } : p
      );

      const newTableCards = [...prev.tableCards, { card, playerId }];
      
      let nextPlayerIndex = (prev.currentPlayerIndex + 1) % 4;
      let newPhase = prev.gamePhase;
      let newMessage = prev.message;
      let newScores = { ...prev.scores };
      let newLastWinnerId = prev.lastWinnerId;
      let newWinningCardIndex = null;

      if (newTableCards.length === 4) {
        const { winnerId, winnerIndexInTable } = determineTrickWinner(newTableCards, prev.trumpCard!.suit);
        const trickPoints = newTableCards.reduce((sum, tc) => sum + tc.card.value, 0);
        const winnerPlayer = prev.players.find(p => p.id === winnerId);
        const winnerTeam = prev.mode === 'partners' ? winnerPlayer!.team : winnerId;

        // Win trick sound
        playSound('winTrick');

        newScores[winnerTeam] = (newScores[winnerTeam] || 0) + trickPoints;
        
        // Special phrases for high value tricks
        if (trickPoints >= 15) {
          playThematicPhrase('highPoints');
        }

        // Check for "Capote" tendency (one team has points, other has 0 and we are halfway through)
        const collectedValues = Object.values(prev.collectedCards) as Card[][];
        const totalCardsPlayed = collectedValues.reduce((sum, cards) => sum + cards.length, 0) + 4;
        if (totalCardsPlayed >= 12) {
          const scores = Object.values(newScores) as number[];
          if (scores.some(s => s > 40) && scores.some(s => s === 0)) {
            playPhrase('Capote à vista!');
          }
        }

        const newCollected = { ...prev.collectedCards };
        newCollected[winnerTeam] = [...(newCollected[winnerTeam] || []), ...newTableCards.map(tc => tc.card)];

        nextPlayerIndex = prev.players.findIndex(p => p.id === winnerId);
        newLastWinnerId = winnerId;
        newWinningCardIndex = winnerIndexInTable;
        newMessage = `Vaza para ${winnerPlayer?.name}! (+${trickPoints} pts)`;

        if (newPlayers.every(p => p.hand.length === 0)) {
          newPhase = 'gameEnd';
          newMessage = 'Fim da partida!';
          playSound('gameEnd');
        } else {
          newPhase = 'roundEnd';
          playSound('roundEnd');
        }

        return {
          ...prev,
          players: newPlayers,
          tableCards: newTableCards,
          currentPlayerIndex: nextPlayerIndex,
          gamePhase: newPhase,
          scores: newScores,
          collectedCards: newCollected,
          message: newMessage,
          lastWinnerId: newLastWinnerId,
          winningCardIndex: newWinningCardIndex,
        };
      }

      const newState = {
        ...prev,
        players: newPlayers,
        tableCards: newTableCards,
        currentPlayerIndex: nextPlayerIndex,
        gamePhase: newPhase,
        scores: newScores,
        message: newMessage,
        lastWinnerId: newLastWinnerId,
        winningCardIndex: newWinningCardIndex,
      };

      if (prev.isOnline && socket && playerId === socket.id) {
        socket.emit('play-card', { roomId: prev.roomId, playerId, cardIndex, gameState: newState });
      }

      return newState;
    });
  }, [socket]);

  // Online Connection
  useEffect(() => {
    if (showOnlineMenu && !socket) {
      const newSocket = io();
      setSocket(newSocket);

      newSocket.on('room-update', (room) => {
        setGameState(prev => ({
          ...prev,
          players: room.players.map((p: any) => ({
            ...p,
            hand: prev.players.find(old => old.id === p.id)?.hand || [],
            isAI: false,
          })),
          roomId: room.id,
          isOnline: true,
          mode: room.mode || 'partners',
        }));
      });

      newSocket.on('game-started', (newGameState) => {
        setGameState(newGameState);
      });

      newSocket.on('card-played', ({ playerId, cardIndex, gameState: newGameState }) => {
        setGameState(newGameState);
      });

      newSocket.on('trump-preview', (suit) => {
        setGameState(prev => ({ ...prev, previewTrump: suit }));
      });

      newSocket.on('game-state-synced', (newGameState) => {
        setGameState(newGameState);
      });

      // WebRTC Signaling Handlers
      newSocket.on('offer', async ({ offer, from }) => {
        const pc = createPeerConnection(from);
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        newSocket.emit('answer', { roomId, answer, to: from });
      });

      newSocket.on('answer', async ({ answer, from }) => {
        const pc = peerConnections.current.get(from);
        if (pc) {
          await pc.setRemoteDescription(new RTCSessionDescription(answer));
        }
      });

      newSocket.on('ice-candidate', async ({ candidate, from }) => {
        const pc = peerConnections.current.get(from);
        if (pc) {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        }
      });

      return () => {
        newSocket.disconnect();
      };
    }
  }, [showOnlineMenu, socket, roomId]);

  // WebRTC Logic
  const createPeerConnection = (peerId: string) => {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    pc.onicecandidate = (event) => {
      if (event.candidate && socket) {
        socket.emit('ice-candidate', { roomId: gameState.roomId, candidate: event.candidate, to: peerId });
      }
    };

    pc.ontrack = (event) => {
      remoteStreams.current.set(peerId, event.streams[0]);
      const audio = document.createElement('audio');
      audio.srcObject = event.streams[0];
      audio.autoplay = true;
      document.body.appendChild(audio);
    };

    if (localStream.current) {
      localStream.current.getTracks().forEach(track => {
        pc.addTrack(track, localStream.current!);
      });
    }

    peerConnections.current.set(peerId, pc);
    return pc;
  };

  const toggleMic = async () => {
    if (isMicOn) {
      localStream.current?.getTracks().forEach(track => track.stop());
      localStream.current = null;
      setIsMicOn(false);
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        localStream.current = stream;
        setIsMicOn(true);
        
        // Add track to existing peer connections
        gameState.players.forEach(p => {
          if (p.id !== socket?.id && !p.isAI) {
            const pc = createPeerConnection(p.id as string);
            stream.getTracks().forEach(track => pc.addTrack(track, stream));
            pc.createOffer().then(offer => {
              pc.setLocalDescription(offer);
              socket?.emit('offer', { roomId: gameState.roomId, offer, to: p.id });
            });
          }
        });
      } catch (err) {
        console.error('Error accessing microphone:', err);
      }
    }
  };

  const joinRoom = () => {
    if (socket && roomId) {
      socket.emit('join-room', { roomId, playerName, mode: gameMode });
    }
  };

  const createRoom = () => {
    const newRoomId = Math.random().toString(36).substring(2, 8).toUpperCase();
    setRoomId(newRoomId);
    if (socket) {
      socket.emit('join-room', { roomId: newRoomId, playerName, mode: gameMode });
    }
  };

  const copyRoomId = () => {
    navigator.clipboard.writeText(roomId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // AI Logic (only in offline or if dealer is local and AI needs to play)
  useEffect(() => {
    if (!gameState.isOnline) {
      const currentPlayer = gameState.players[gameState.currentPlayerIndex];
      if (currentPlayer.isAI) {
        if (gameState.gamePhase === 'trumpSelection') {
          const timer = setTimeout(() => {
            // AI selects suit with most cards
            const suitCounts: Record<string, number> = {};
            currentPlayer.hand.forEach(c => {
              suitCounts[c.suit] = (suitCounts[c.suit] || 0) + 1;
            });
            const bestSuit = Object.entries(suitCounts).sort((a, b) => b[1] - a[1])[0][0] as Suit;
            selectTrump(bestSuit);
          }, 1500);
          return () => clearTimeout(timer);
        }

        if (gameState.gamePhase === 'playing') {
          const timer = setTimeout(() => {
            const tableCards = gameState.tableCards;
            const trumpSuit = gameState.trumpCard!.suit;
            let cardIndex = 0;

            if (tableCards.length === 0) {
              // Leading: play strongest non-trump or strongest trump
              const nonTrumps = currentPlayer.hand.filter(c => c.suit !== trumpSuit);
              if (nonTrumps.length > 0) {
                const sorted = [...nonTrumps].sort((a, b) => b.strength - a.strength);
                cardIndex = currentPlayer.hand.indexOf(sorted[0]);
              } else {
                const sorted = [...currentPlayer.hand].sort((a, b) => b.strength - a.strength);
                cardIndex = currentPlayer.hand.indexOf(sorted[0]);
              }
            } else {
              const { winnerId, winnerIndexInTable } = determineTrickWinner(tableCards, trumpSuit);
              const partnerId = gameState.mode === 'partners' ? (gameState.currentPlayerIndex + 2) % 4 : -1;
              const partner = gameState.players[partnerId];
              const isPartnerWinning = partner && winnerId === partner.id;

              if (isPartnerWinning) {
                // Partner is winning: play highest value card (points) to help team
                const sorted = [...currentPlayer.hand].sort((a, b) => b.value - a.value);
                cardIndex = currentPlayer.hand.indexOf(sorted[0]);
              } else {
                // Opponent is winning: try to beat or discard
                const bestOnTable = tableCards[winnerIndexInTable].card;
                
                // Find cards that can win
                const winningCards = currentPlayer.hand.filter(c => {
                  if (c.suit === bestOnTable.suit) return c.strength > bestOnTable.strength;
                  if (c.suit === trumpSuit && bestOnTable.suit !== trumpSuit) return true;
                  if (c.suit === trumpSuit && bestOnTable.suit === trumpSuit) return c.strength > bestOnTable.strength;
                  return false;
                });

                if (winningCards.length > 0) {
                  // Play the smallest winning card to save big ones
                  const sorted = [...winningCards].sort((a, b) => a.strength - b.strength);
                  cardIndex = currentPlayer.hand.indexOf(sorted[0]);
                } else {
                  // Cannot win: play lowest value card (save points)
                  const sorted = [...currentPlayer.hand].sort((a, b) => a.value - b.value);
                  cardIndex = currentPlayer.hand.indexOf(sorted[0]);
                }
              }
            }
            playCard(currentPlayer.id, cardIndex);
          }, 1000);
          return () => clearTimeout(timer);
        }
      }
    }
  }, [gameState.currentPlayerIndex, gameState.gamePhase, gameState.players, gameState.tableCards, gameState.trumpCard, playCard, selectTrump, gameState.isOnline]);

  // Handle round end
  useEffect(() => {
    if (gameState.gamePhase === 'roundEnd') {
      const timer = setTimeout(() => {
        setGameState(prev => ({
          ...prev,
          tableCards: [],
          gamePhase: 'playing',
          message: '',
          winningCardIndex: null,
        }));
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [gameState.gamePhase]);

  const canPlayCard = (card: Card) => {
    if (gameState.gamePhase !== 'playing') return false;
    const currentPlayer = gameState.players[gameState.currentPlayerIndex];
    if (gameState.isOnline) {
      return currentPlayer.id === socket?.id;
    }
    return gameState.currentPlayerIndex === 0;
  };

  if (showIntro) {
    return (
      <div className="flex flex-col items-center justify-center h-screen p-6 text-center bg-moz-black">
        <motion.div
          initial={{ y: -50, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="max-w-md w-full"
        >
          <div className="mb-8 flex justify-center">
            <div className="w-32 h-32 bg-moz-red rounded-full flex items-center justify-center border-4 border-moz-yellow shadow-2xl">
              <Trophy className="w-16 h-16 text-moz-yellow" />
            </div>
          </div>
          <motion.h1 
            animate={{ 
              color: ["#FFD100", "#009739", "#FFD100"] 
            }}
            transition={{ 
              duration: 4, 
              repeat: Infinity, 
              ease: "easeInOut" 
            }}
            className="text-5xl font-black mb-4 tracking-tighter uppercase italic"
          >
            INTRUFO
          </motion.h1>

          <div className="mb-8 space-y-2">
            <label className="text-[10px] font-black text-moz-yellow uppercase tracking-[0.2em]">Escolha seu Apelido</label>
            <input
              type="text"
              placeholder="Seu Apelido"
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-xl p-4 text-white text-center font-black uppercase tracking-widest outline-none focus:border-moz-yellow focus:bg-white/10 transition-all"
            />
          </div>
          
          {!showOnlineMenu ? (
            <>
              <p className="text-moz-white/80 mb-8 text-lg leading-relaxed">
                O clássico jogo de cartas moçambicano. Agora com modo online!
              </p>
              <div className="flex flex-col gap-4">
            <button 
              onClick={() => setShowRules(true)}
              className="text-moz-yellow/60 text-xs uppercase font-bold hover:text-moz-yellow flex items-center justify-center gap-1 mb-2"
            >
              <Info className="w-3 h-3" /> Ver Regras e Pontuação
            </button>
            <button
              onClick={() => { setShowIntro(false); startNewGame(false, gameMode); }}
              className="w-full py-4 bg-moz-green hover:bg-moz-green/90 text-white font-black rounded-xl shadow-lg transition-all flex items-center justify-center gap-2 text-xl uppercase"
            >
              <Play className="fill-current" /> Jogar Offline
            </button>
                <button
                  onClick={() => setShowOnlineMenu(true)}
                  className="w-full py-4 bg-moz-yellow hover:bg-moz-yellow/90 text-moz-black font-black rounded-xl shadow-lg transition-all flex items-center justify-center gap-2 text-xl uppercase"
                >
                  <Users /> Modo Online
                </button>
              </div>
            </>
          ) : (
            <div className="bg-white/5 p-6 rounded-2xl border border-white/10 flex flex-col gap-4">
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Código da Sala"
                  value={roomId}
                  onChange={(e) => setRoomId(e.target.value.toUpperCase())}
                  className="flex-1 bg-moz-black border border-white/20 rounded-lg p-3 text-white outline-none focus:border-moz-yellow"
                />
                <button
                  onClick={joinRoom}
                  className="bg-moz-green px-6 rounded-lg font-bold uppercase text-sm"
                >
                  Entrar
                </button>
              </div>
              <div className="relative">
                <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-white/10"></div></div>
                <div className="relative flex justify-center text-xs uppercase"><span className="bg-moz-black px-2 text-white/30">Ou</span></div>
              </div>
              <button
                onClick={createRoom}
                className="w-full py-3 border-2 border-moz-yellow text-moz-yellow font-bold rounded-lg hover:bg-moz-yellow/10 transition-all uppercase"
              >
                Criar Nova Sala
              </button>
              <button
                onClick={() => setShowOnlineMenu(false)}
                className="text-white/50 text-xs uppercase font-bold hover:text-white"
              >
                Voltar
              </button>
            </div>
          )}
        </motion.div>
      </div>
    );
  }

  const isHost = gameState.isOnline && gameState.players[0]?.id === socket?.id;

  const RulesModal = () => (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[200] flex items-center justify-center bg-moz-black/95 backdrop-blur-md p-4 overflow-y-auto"
    >
      <div className="max-w-2xl w-full bg-white/5 border border-white/10 rounded-3xl p-8 relative">
        <button 
          onClick={() => setShowRules(false)}
          className="absolute top-4 right-4 p-2 hover:bg-white/10 rounded-full transition-colors"
        >
          <X className="w-6 h-6 text-white/50" />
        </button>

        <h2 className="text-3xl font-black text-moz-yellow mb-6 uppercase italic flex items-center gap-3">
          <Info className="w-8 h-8" /> Regras do Intrufo
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 text-left">
          <div>
            <h3 className="text-moz-green font-bold uppercase text-sm mb-3 tracking-widest">O Baralho</h3>
            <p className="text-white/70 text-sm mb-4">
              O Intrufo usa um baralho reduzido de 24 cartas (A, K, J, Q, 7, 6) em quatro naipes.
            </p>
            
            <h3 className="text-moz-green font-bold uppercase text-sm mb-3 tracking-widest">Pontuação das Cartas</h3>
            <div className="grid grid-cols-2 gap-2">
              {[
                { rank: 'Ás (A)', pts: 11 },
                { rank: '7', pts: 10 },
                { rank: 'Rei (K)', pts: 4 },
                { rank: 'Valete (J)', pts: 3 },
                { rank: 'Dama (Q)', pts: 2 },
                { rank: '6', pts: 0 },
              ].map(item => (
                <div key={item.rank} className="flex justify-between bg-white/5 p-2 rounded border border-white/5">
                  <span className="font-bold text-white">{item.rank}</span>
                  <span className="text-moz-yellow font-black">{item.pts} pts</span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-moz-red font-bold uppercase text-sm mb-3 tracking-widest">Como Jogar</h3>
            <ul className="text-white/70 text-sm space-y-3 list-disc pl-4">
              <li>Cada jogador recebe 6 cartas.</li>
              <li>A última carta do distribuidor define o <strong>Trunfo</strong> (naipe mais forte).</li>
              <li><strong>Sem restrições:</strong> Qualquer carta pode ser jogada em qualquer altura, sem obrigatoriedade de seguir o naipe.</li>
              <li>O objetivo é ganhar vazas para acumular os pontos das cartas jogadas.</li>
              <li>Ganha a vaza quem jogar a carta mais forte do naipe inicial ou o Trunfo mais alto.</li>
              <li>No modo <strong>Duplas</strong>, os pontos são somados com o seu parceiro.</li>
              <li>No modo <strong>Individual</strong>, cada um por si!</li>
            </ul>
          </div>
        </div>

        <button
          onClick={() => setShowRules(false)}
          className="mt-8 w-full py-4 bg-moz-yellow text-moz-black font-black rounded-xl uppercase tracking-widest hover:scale-105 transition-transform"
        >
          Entendi, vamos jogar!
        </button>
      </div>
    </motion.div>
  );

  const SettingsModal = () => (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[250] flex items-center justify-center bg-moz-black/90 backdrop-blur-md p-6"
    >
      <div className="max-w-md w-full bg-white/5 border border-white/10 rounded-3xl p-8">
        <div className="flex justify-between items-center mb-8">
          <h2 className="text-2xl font-black text-moz-yellow uppercase italic">Configurações</h2>
          <button onClick={() => setShowSettings(false)} className="p-2 hover:bg-white/10 rounded-full transition-colors">
            <X className="w-6 h-6 text-white/50" />
          </button>
        </div>

        <div className="space-y-8">
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2">
                <Volume2 className="w-5 h-5 text-moz-yellow" />
                <span className="text-sm font-bold text-white uppercase tracking-widest">Efeitos Sonoros</span>
              </div>
              <span className="text-xs font-black text-moz-yellow">{Math.round(sfxVol * 100)}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={sfxVol}
              onChange={(e) => {
                const val = parseFloat(e.target.value);
                setSfxVol(val);
                setSfxVolume(val);
              }}
              className="w-full h-2 bg-white/10 rounded-lg appearance-none cursor-pointer accent-moz-yellow"
            />
          </div>

          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2">
                <Volume2 className="w-5 h-5 text-moz-green" />
                <span className="text-sm font-bold text-white uppercase tracking-widest">Frases de Áudio</span>
              </div>
              <span className="text-xs font-black text-moz-green">{Math.round(phraseVol * 100)}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={phraseVol}
              onChange={(e) => {
                const val = parseFloat(e.target.value);
                setPhraseVol(val);
                setPhraseVolume(val);
              }}
              className="w-full h-2 bg-white/10 rounded-lg appearance-none cursor-pointer accent-moz-green"
            />
          </div>
        </div>

        <button
          onClick={() => {
            setShowSettings(false);
            playSound('play');
          }}
          className="w-full mt-10 py-4 bg-moz-yellow text-moz-black font-black rounded-xl shadow-lg uppercase tracking-widest hover:scale-105 transition-transform"
        >
          Salvar e Fechar
        </button>
      </div>
    </motion.div>
  );

  const updateGameMode = (mode: 'partners' | 'individual') => {
    setGameMode(mode);
    if (isHost && socket) {
      socket.emit('update-room-mode', { roomId: gameState.roomId, mode });
    }
  };

  // Lobby View
  if (gameState.isOnline && gameState.gamePhase === 'dealing') {
    return (
      <div className="flex flex-col items-center justify-center h-screen p-6 text-center bg-moz-black">
        <div className="max-w-md w-full bg-white/5 p-8 rounded-3xl border border-white/10">
          <h2 className="text-2xl font-black text-moz-yellow mb-2 uppercase italic">Sala de Espera</h2>
          
          {isHost && (
            <div className="flex flex-col gap-2 mb-6">
              <span className="text-[10px] uppercase font-bold text-white/30 text-left ml-1">Modo de Jogo</span>
              <div className="flex gap-2 p-1 bg-white/5 rounded-xl border border-white/10">
                <button
                  onClick={() => updateGameMode('partners')}
                  className={`flex-1 py-2 rounded-lg text-xs font-bold uppercase transition-all ${gameState.mode === 'partners' ? 'bg-moz-yellow text-moz-black' : 'text-white/50 hover:text-white'}`}
                >
                  Em Duplas
                </button>
                <button
                  onClick={() => updateGameMode('individual')}
                  className={`flex-1 py-2 rounded-lg text-xs font-bold uppercase transition-all ${gameState.mode === 'individual' ? 'bg-moz-yellow text-moz-black' : 'text-white/50 hover:text-white'}`}
                >
                  Individual
                </button>
              </div>
            </div>
          )}

          <div className="flex items-center justify-center gap-2 mb-8 bg-moz-black/50 p-3 rounded-xl border border-white/10">
            <span className="text-moz-white/50 text-xs font-bold uppercase">Código:</span>
            <span className="text-xl font-mono font-bold tracking-widest text-white">{roomId}</span>
            <button onClick={copyRoomId} className="ml-2 p-2 hover:bg-white/10 rounded-lg transition-colors">
              {copied ? <Check className="w-4 h-4 text-moz-green" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>

          <div className="flex flex-col gap-3 mb-8">
            {gameState.players.map((p, i) => (
              <div key={i} className="flex items-center justify-between bg-white/5 p-3 rounded-lg border border-white/5">
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center ${p.team === 0 ? 'bg-moz-green' : 'bg-moz-red'}`}>
                    <User className="w-4 h-4 text-white" />
                  </div>
                  <span className="font-bold text-white">{p.name} {p.id === socket?.id && '(Você)'}</span>
                </div>
                <span className="text-[10px] uppercase font-bold text-white/30">Equipa {p.team + 1}</span>
              </div>
            ))}
            {[...Array(4 - gameState.players.length)].map((_, i) => (
              <div key={i} className="flex items-center justify-center bg-white/5 p-3 rounded-lg border border-white/5 border-dashed">
                <span className="text-[10px] uppercase font-bold text-white/20 animate-pulse">Aguardando jogador...</span>
              </div>
            ))}
          </div>

          {gameState.players.length === 4 && isHost && (
            <button
              onClick={() => startNewGame(true, gameState.mode)}
              className="w-full py-4 bg-moz-green text-white font-black rounded-xl shadow-lg uppercase text-lg hover:scale-105 transition-transform"
            >
              Começar Partida
            </button>
          )}
          
          <p className="text-xs text-white/30 mt-4">
            {gameState.players.length < 4 
              ? "Aguardando mais jogadores para iniciar..." 
              : isHost 
                ? "Sala cheia! Escolha o modo e clique em Começar." 
                : "Aguardando o anfitrião iniciar a partida..."}
          </p>
        </div>
      </div>
    );
  }

  const currentPlayer = gameState.players[gameState.currentPlayerIndex];
  const isMyTurn = gameState.isOnline ? currentPlayer?.id === socket?.id : gameState.currentPlayerIndex === 0;

  const TrumpSelectionModal = () => {
    const dealer = gameState.players[gameState.dealerIndex];
    const isDealer = gameState.isOnline ? dealer.id === socket?.id : gameState.dealerIndex === 0;

    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[150] flex items-center justify-center bg-moz-black backdrop-blur-sm p-6"
      >
        <div className="max-w-md w-full bg-zinc-900 border border-white/20 rounded-3xl p-8 text-center shadow-2xl">
          <h2 className="text-2xl font-black text-moz-yellow mb-2 uppercase italic">Seleção de Trunfo</h2>
          <p className="text-white/70 text-sm mb-8">
            {isDealer ? 'Escolha o trunfo para esta partida:' : `Aguardando ${dealer.name} escolher o trunfo...`}
          </p>

          <div className="grid grid-cols-2 gap-4 mb-4">
            {SUITS.map(suit => {
              return (
                <button
                  key={suit}
                  onClick={() => isDealer && selectTrump(suit)}
                  className={`bg-zinc-800 border-2 p-6 rounded-2xl transition-all hover:scale-105 group relative overflow-hidden ${
                    isDealer ? 'border-white/10 hover:border-moz-yellow active:scale-95' : 'border-white/5 opacity-50 cursor-default'
                  }`}
                >
                  <span className={`text-5xl block mb-2 ${SUIT_COLORS[suit]}`}>
                    {SUIT_SYMBOLS[suit]}
                  </span>
                  <span className="text-xs uppercase font-black text-white/80">
                    {suit}
                  </span>
                </button>
              );
            })}
          </div>

          {!isDealer && gameState.previewTrump && (
            <p className="text-moz-yellow font-bold animate-pulse uppercase text-xs tracking-widest mt-4">
              {dealer.name} está a selecionar...
            </p>
          )}
        </div>
      </motion.div>
    );
  };

  const RoundEndModal = () => {
    const winner = gameState.players.find(p => p.id === gameState.lastWinnerId);
    const trickPoints = gameState.tableCards.reduce((sum, tc) => sum + tc.card.value, 0);

    return (
      <motion.div
        initial={{ opacity: 0, x: -50 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -50 }}
        transition={{ delay: 1, duration: 0.5 }}
        className="fixed bottom-48 left-6 z-[200] pointer-events-none"
      >
        <div className="bg-moz-black/90 backdrop-blur-xl border border-moz-yellow/50 rounded-2xl p-4 shadow-[0_0_30px_rgba(255,209,0,0.2)] w-48">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-8 h-8 bg-moz-yellow rounded-full flex items-center justify-center shrink-0">
              <Trophy className="w-4 h-4 text-moz-black" />
            </div>
            <div className="text-left">
              <p className="text-[10px] font-black text-white/50 uppercase tracking-tighter">Vaza Coletada</p>
              <p className="text-xs font-black text-moz-yellow uppercase truncate w-28 italic">
                {winner?.name}
              </p>
            </div>
          </div>
          <div className="bg-white/5 rounded-xl p-2 border border-white/10 flex justify-between items-center">
            <span className="text-[10px] uppercase font-bold text-white/30">Pontos</span>
            <span className="text-xl font-black text-moz-green">+{trickPoints}</span>
          </div>
        </div>
      </motion.div>
    );
  };

  return (
    <div className="relative h-screen flex flex-col bg-moz-black overflow-hidden select-none">
      {/* Header / Scoreboard */}
      <div className="p-4 flex justify-between items-center bg-moz-black/50 backdrop-blur-md border-b border-white/10 z-50">
        <div className="flex items-center gap-6">
          <div className="flex gap-4 overflow-x-auto no-scrollbar">
            {gameState.mode === 'partners' ? (
              <>
                <div className="flex flex-col min-w-fit">
                  <span className="text-[10px] uppercase font-bold text-moz-white/50">Nossa Equipa</span>
                  <span className="text-2xl font-black text-moz-green">{gameState.scores[0] || 0}</span>
                </div>
                <div className="flex flex-col min-w-fit">
                  <span className="text-[10px] uppercase font-bold text-moz-white/50">Adversários</span>
                  <span className="text-2xl font-black text-moz-red">{gameState.scores[1] || 0}</span>
                </div>
              </>
            ) : (
              gameState.players.map(p => (
                <div key={p.id} className="flex flex-col min-w-fit">
                  <span className="text-[10px] uppercase font-bold text-moz-white/50 truncate max-w-[80px]">{p.name}</span>
                  <span className={`text-2xl font-black ${p.id === 0 ? 'text-moz-green' : 'text-moz-yellow'}`}>{gameState.scores[p.id] || 0}</span>
                </div>
              ))
            )}
          </div>

          {/* Card Counters */}
          <div className="hidden md:flex items-center gap-3 border-l border-white/10 pl-6">
            {gameState.players.map((p, i) => (
              <div key={p.id} className="flex flex-col items-center">
                <div className="flex items-center gap-1">
                  <div className={`w-1.5 h-1.5 rounded-full ${gameState.currentPlayerIndex === i ? 'bg-moz-yellow animate-pulse' : 'bg-white/20'}`} />
                  <span className="text-[8px] uppercase font-bold text-white/30 truncate max-w-[40px]">{p.name}</span>
                </div>
                <div className="flex items-center gap-1 bg-white/5 px-1.5 py-0.5 rounded border border-white/5">
                  <Layers className="w-2.5 h-2.5 text-moz-yellow/50" />
                  <span className="text-[10px] font-black text-white/80">{p.hand.length}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          <button 
            onClick={() => setShowSettings(true)}
            className="p-2 hover:bg-white/10 rounded-full transition-colors text-white/50"
            title="Configurações"
          >
            <Settings className="w-5 h-5" />
          </button>
          <button 
            onClick={() => setShowRules(true)}
            className="p-2 hover:bg-white/10 rounded-full transition-colors text-white/50"
            title="Regras do Jogo"
          >
            <Info className="w-5 h-5" />
          </button>
          <button 
            onClick={toggleMic}
            className={`p-2 rounded-full transition-all ${isMicOn ? 'bg-moz-green text-white' : 'bg-white/10 text-white/50'}`}
          >
            {isMicOn ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
          </button>
          
          {gameState.trumpCard && (
            <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-full border border-moz-yellow shadow-[0_0_15px_rgba(255,209,0,0.3)]">
              <span className="text-[10px] uppercase font-black text-moz-black/50">Trunfo:</span>
              <span className={`text-xl font-black ${SUIT_COLORS[gameState.trumpCard.suit]}`}>
                {SUIT_SYMBOLS[gameState.trumpCard.suit]}
              </span>
            </div>
          )}
          <button 
            onClick={() => gameState.isOnline ? null : startNewGame()}
            className={`p-2 hover:bg-white/10 rounded-full transition-colors ${gameState.isOnline ? 'opacity-20 cursor-not-allowed' : ''}`}
            title="Reiniciar Jogo"
          >
            <RotateCcw className="w-5 h-5" />
          </button>
          {!gameState.isOnline && (
            <button 
              onClick={() => setShowIntro(true)}
              className="p-2 hover:bg-white/10 rounded-full transition-colors text-moz-red"
              title="Sair do Jogo"
            >
              <LogOut className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      {/* Game Area */}
      <div className="flex-1 relative flex items-center justify-center">
        {/* Opponent Top */}
        <div className="absolute top-8 left-1/2 -translate-x-1/2 flex flex-col items-center">
          <div className="flex items-center gap-2 mb-3 bg-moz-black/60 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/10 shadow-lg">
            {gameState.players[2]?.isAI ? <Cpu className="w-4 h-4 text-moz-red" /> : <User className="w-4 h-4 text-moz-green" />}
            <span className="text-xs font-black uppercase tracking-wider text-white italic">
              {gameState.players[2]?.name || 'Vazio'}
            </span>
          </div>
          <div className="flex">
            {gameState.players[2]?.hand.map((_, i) => (
              <CardComponent 
                key={i} 
                card={{} as Card} 
                isFaceUp={false} 
                index={i} 
                className="scale-75" 
                playerLevel={gameState.players[2]?.level}
                delay={(i * 4 + 2) * 0.208}
              />
            ))}
          </div>
        </div>

        {/* AI/Player Left */}
        <div className="absolute left-8 top-1/2 -translate-y-1/2 flex flex-col items-center rotate-90">
          <div className="flex items-center gap-2 mb-3 -rotate-90 bg-moz-black/60 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/10 shadow-lg">
            {gameState.players[1]?.isAI ? <Cpu className="w-4 h-4 text-moz-red" /> : <User className="w-4 h-4 text-moz-green" />}
            <span className="text-xs font-black uppercase tracking-wider text-white italic">
              {gameState.players[1]?.name || 'Vazio'}
            </span>
          </div>
          <div className="flex">
            {gameState.players[1]?.hand.map((_, i) => (
              <CardComponent 
                key={i} 
                card={{} as Card} 
                isFaceUp={false} 
                index={i} 
                className="scale-75" 
                playerLevel={gameState.players[1]?.level}
                delay={(i * 4 + 1) * 0.208}
              />
            ))}
          </div>
        </div>

        {/* AI/Player Right */}
        <div className="absolute right-8 top-1/2 -translate-y-1/2 flex flex-col items-center -rotate-90">
          <div className="flex items-center gap-2 mb-3 rotate-90 bg-moz-black/60 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/10 shadow-lg">
            {gameState.players[3]?.isAI ? <Cpu className="w-4 h-4 text-moz-red" /> : <User className="w-4 h-4 text-moz-green" />}
            <span className="text-xs font-black uppercase tracking-wider text-white italic">
              {gameState.players[3]?.name || 'Vazio'}
            </span>
          </div>
          <div className="flex">
            {gameState.players[3]?.hand.map((_, i) => (
              <CardComponent 
                key={i} 
                card={{} as Card} 
                isFaceUp={false} 
                index={i} 
                className="scale-75" 
                playerLevel={gameState.players[3]?.level}
                delay={(i * 4 + 3) * 0.208}
              />
            ))}
          </div>
        </div>

        {/* Dealing Hand Animation */}
        <AnimatePresence>
          {isDealing && dealingTarget && (
            <motion.div
              initial={{ x: 0, y: 0, opacity: 0 }}
              animate={{ 
                x: dealingTarget.x, 
                y: dealingTarget.y, 
                opacity: 1,
                rotate: [0, -10, 10, 0]
              }}
              exit={{ opacity: 0 }}
              transition={{ 
                type: "spring", 
                stiffness: 100, 
                damping: 15,
                rotate: { repeat: Infinity, duration: 0.5 }
              }}
              className="absolute z-[200] pointer-events-none"
            >
              <div className="relative">
                <Hand className="w-16 h-16 text-moz-yellow fill-moz-yellow/20 drop-shadow-2xl" />
                <div className="absolute top-0 left-0 w-8 h-12 bg-moz-red/40 rounded-sm -rotate-12 translate-x-4 translate-y-2 border border-white/20" />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Table Center */}
        <div className="relative w-64 h-64 flex items-center justify-center">
          <AnimatePresence>
            {gameState.tableCards.map((tc, i) => {
              const playerIdx = gameState.players.findIndex(p => p.id === tc.playerId);
              const positions = [
                { y: 60, x: 0, rotate: 0 },    // Bottom
                { y: 0, x: -60, rotate: 90 },  // Left
                { y: -60, x: 0, rotate: 180 }, // Top
                { y: 0, x: 60, rotate: -90 },  // Right
              ];
              const pos = positions[playerIdx] || { y: 0, x: 0, rotate: 0 };
              
              const isWinner = gameState.winningCardIndex === i;
              const winnerIdx = gameState.players.findIndex(p => p.id === gameState.lastWinnerId);
              const winnerPos = positions[winnerIdx] || { x: 0, y: 0 };

              return (
                <motion.div
                  key={`${tc.playerId}-${tc.card.suit}-${tc.card.rank}`}
                  initial={{ opacity: 0, scale: 0.5, x: pos.x * 2, y: pos.y * 2 }}
                  animate={{ 
                    opacity: 1, 
                    scale: isWinner ? 1.1 : 1, 
                    x: gameState.gamePhase === 'roundEnd' ? winnerPos.x * 3 : pos.x, 
                    y: gameState.gamePhase === 'roundEnd' ? winnerPos.y * 3 : pos.y, 
                    rotate: pos.rotate,
                    zIndex: isWinner ? 50 : i
                  }}
                  exit={{ opacity: 0, scale: 0.5 }}
                  transition={{ 
                    type: "spring", 
                    stiffness: 300, 
                    damping: 25,
                    duration: gameState.gamePhase === 'roundEnd' ? 0.4 : 0.6
                  }}
                  className={`absolute ${isWinner ? 'ring-4 ring-moz-yellow rounded-lg shadow-[0_0_20px_rgba(255,215,0,0.5)]' : ''}`}
                >
                  <CardComponent 
                    card={tc.card} 
                    className="scale-90 shadow-2xl" 
                    playerName={gameState.players.find(p => p.id === tc.playerId)?.name}
                    playerLevel={gameState.players.find(p => p.id === tc.playerId)?.level}
                    delay={0}
                  />
                  {isWinner && (
                    <motion.div 
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="absolute -bottom-8 left-1/2 -translate-x-1/2 bg-moz-yellow text-moz-black text-[10px] px-2 py-1 rounded font-black uppercase whitespace-nowrap shadow-lg"
                    >
                      Vencedor!
                    </motion.div>
                  )}
                </motion.div>
              );
            })}
          </AnimatePresence>
          
          {/* Center Message */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            {gameState.message && (
              <div className="bg-moz-black/80 backdrop-blur-sm px-4 py-2 rounded-full border border-moz-yellow/30 text-center">
                <p className="text-[10px] font-black text-moz-yellow uppercase tracking-widest animate-pulse">
                  {gameState.message}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* User Hand */}
      <div className="p-8 flex flex-col items-center bg-gradient-to-t from-moz-black to-transparent">
        <div className="flex items-center gap-3 mb-4 bg-moz-black/60 backdrop-blur-md px-4 py-2 rounded-full border border-moz-yellow/30 shadow-xl">
          <User className={`w-5 h-5 ${isMyTurn ? 'text-moz-yellow animate-bounce' : 'text-moz-green'}`} />
          <span className={`text-sm font-black uppercase tracking-widest italic ${isMyTurn ? 'text-moz-yellow' : 'text-white'}`}>
            {isMyTurn ? 'Sua Vez!' : playerName}
          </span>
        </div>
        <div className="flex justify-center items-end h-40">
          {gameState.players.find(p => gameState.isOnline ? p.id === socket?.id : p.id === 0)?.hand.map((card, i) => {
            const me = gameState.players.find(p => gameState.isOnline ? p.id === socket?.id : p.id === 0);
            return (
              <CardComponent
                key={`${card.suit}-${card.rank}`}
                card={card}
                index={i}
                onClick={() => playCard(gameState.isOnline ? socket!.id : 0, i)}
                disabled={!canPlayCard(card)}
                playerLevel={me?.level}
                delay={(i * 4 + 0) * 0.208}
              />
            );
          })}
        </div>
      </div>

      {/* Game End Modal */}
      {gameState.gamePhase === 'gameEnd' && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="absolute inset-0 z-[100] flex items-center justify-center bg-moz-black/95 backdrop-blur-xl p-6 overflow-y-auto"
        >
          <div className="text-center w-full max-w-4xl py-12">
            <Trophy className="w-20 h-20 text-moz-yellow mx-auto mb-6" />
            <h2 className="text-4xl font-black text-moz-white mb-2 italic uppercase">Resultado Final</h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-12 mt-8">
              {gameState.mode === 'partners' ? (
                [0, 1].map(teamId => {
                  const collected = gameState.collectedCards[teamId] || [];
                  const totalPoints = collected.reduce((sum, c) => sum + c.value, 0);
                  return (
                    <div key={teamId} className="bg-white/5 border border-white/10 rounded-3xl p-6 flex flex-col">
                      <div className="flex justify-between items-center mb-6">
                        <span className="text-lg font-black uppercase text-moz-white/50 italic">
                          {teamId === 0 ? 'Nossa Equipa' : 'Adversários'}
                        </span>
                        <div className="text-right">
                          <span className={`text-5xl font-black block ${teamId === 0 ? 'text-moz-green' : 'text-moz-red'}`}>
                            {totalPoints}
                          </span>
                          <span className="text-[10px] uppercase font-bold text-white/20 tracking-widest">Pontos Totais</span>
                        </div>
                      </div>
                      
                      <div className="flex-1 overflow-y-auto max-h-48 custom-scrollbar mb-6">
                        <div className="flex flex-wrap justify-center gap-2 p-2">
                          {collected.map((card, i) => (
                            <div key={i} className="scale-50 -m-6 hover:scale-75 transition-transform hover:z-10">
                              <CardComponent 
                                card={card} 
                                playerLevel={gameState.players.find(p => p.team === teamId)?.level}
                                delay={i * 0.05}
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                      
                      <div className="pt-4 border-t border-white/5 text-xs font-bold text-white/20 uppercase tracking-widest">
                        {collected.length} Cartas Coletadas
                      </div>
                    </div>
                  );
                })
              ) : (
                gameState.players.map(p => {
                  const collected = gameState.collectedCards[p.id] || [];
                  const totalPoints = collected.reduce((sum, c) => sum + c.value, 0);
                  return (
                    <div key={p.id} className="bg-white/5 border border-white/10 rounded-3xl p-6 flex flex-col">
                      <div className="flex justify-between items-center mb-6">
                        <span className="text-lg font-black uppercase text-moz-white/50 italic">{p.name}</span>
                        <div className="text-right">
                          <span className={`text-5xl font-black block ${p.id === 0 ? 'text-moz-green' : 'text-moz-yellow'}`}>
                            {totalPoints}
                          </span>
                          <span className="text-[10px] uppercase font-bold text-white/20 tracking-widest">Pontos Totais</span>
                        </div>
                      </div>
                      
                      <div className="flex-1 overflow-y-auto max-h-48 custom-scrollbar mb-6">
                        <div className="flex flex-wrap justify-center gap-2 p-2">
                          {collected.map((card, i) => (
                            <div key={i} className="scale-50 -m-6 hover:scale-75 transition-transform hover:z-10">
                              <CardComponent 
                                card={card} 
                                playerLevel={p.level}
                                delay={i * 0.05}
                              />
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="pt-4 border-t border-white/5 text-xs font-bold text-white/20 uppercase tracking-widest">
                        {collected.length} Cartas Coletadas
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
              <button
                onClick={() => gameState.isOnline ? setShowIntro(true) : startNewGame()}
                className="w-full max-w-xs py-4 bg-moz-yellow text-moz-black font-black rounded-xl shadow-lg hover:scale-105 transition-transform flex items-center justify-center gap-2 text-xl uppercase"
              >
                <RotateCcw className="w-6 h-6" /> {gameState.isOnline ? 'Sair da Sala' : 'Jogar Novamente'}
              </button>
              <button
                onClick={() => setShowIntro(true)}
                className="w-full max-w-xs py-4 bg-white/10 text-white font-black rounded-xl shadow-lg hover:scale-105 transition-transform flex items-center justify-center gap-2 text-xl uppercase border border-white/10"
              >
                <LogOut className="w-6 h-6" /> Menu Principal
              </button>
            </div>
          </div>
        </motion.div>
      )}

      <AnimatePresence>
        {showRules && <RulesModal />}
        {showSettings && <SettingsModal />}
        {gameState.gamePhase === 'trumpSelection' && <TrumpSelectionModal />}
        {gameState.gamePhase === 'roundEnd' && <RoundEndModal />}
      </AnimatePresence>
    </div>
  );
}
