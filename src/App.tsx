/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { 
  Mic, 
  FileText, 
  Upload, 
  CheckCircle2, 
  Mail, 
  Search, 
  History, 
  Home,
  Settings, 
  Plus, 
  X, 
  ChevronRight, 
  Download,
  Send,
  Loader2,
  Trash2,
  Calendar,
  User,
  Menu,
  Check,
  Square,
  Circle,
  Clock,
  Copy,
  CheckCircle,
  ExternalLink,
  Sparkles,
  ArrowRight,
  LogOut
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI, Type } from "@google/genai";
import Markdown from 'react-markdown';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

import { auth, db, googleProvider, signInWithPopup, signOut } from './firebase';
import { 
  collection, 
  addDoc, 
  query, 
  where, 
  onSnapshot, 
  orderBy, 
  updateDoc, 
  doc, 
  deleteDoc, 
  Timestamp,
  getDocFromServer
} from 'firebase/firestore';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: any;
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean, error: any }> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
          <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 text-center">
            <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-6">
              <X size={32} />
            </div>
            <h1 className="text-2xl font-bold text-gray-900 mb-4">エラーが発生しました</h1>
            <p className="text-gray-600 mb-8">
              申し訳ありません。アプリケーションの実行中に予期しないエラーが発生しました。
            </p>
            <button
              onClick={() => window.location.reload()}
              className="w-full bg-brand-indigo text-white py-3 rounded-xl font-bold hover:bg-opacity-90 transition-all"
            >
              ページを再読み込み
            </button>
            {process.env.NODE_ENV !== 'production' && (
              <pre className="mt-8 p-4 bg-gray-100 rounded-lg text-left text-xs overflow-auto max-h-40">
                {this.state.error?.message}
              </pre>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

type Tab = 'home' | 'create' | 'tasks' | 'knowledge' | 'all-minutes' | 'all-tasks';

interface Minute {
  id: string;
  title: string;
  content: string;
  summary: string;
  format: string;
  createdAt: Timestamp;
  uid: string;
}

interface Task {
  id: string;
  minuteId: string;
  text: string;
  assignee: string;
  dueDate: string;
  status: 'pending' | 'completed';
  createdAt: Timestamp;
  uid: string;
  minuteTitle?: string;
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}

function AppContent() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('home');
  const [taskFilter, setTaskFilter] = useState<'all' | 'pending' | 'completed'>('all');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [minutes, setMinutes] = useState<Minute[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [chatMessages, setChatMessages] = useState<{ role: 'user' | 'ai', content: string }[]>([]);
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [isReExtracting, setIsReExtracting] = useState(false);
  const [generatedResult, setGeneratedResult] = useState<{ title: string, summary: string, tasks: any[], email: string } | null>(null);
  const [selectedMinute, setSelectedMinute] = useState<Minute | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isTextModalOpen, setIsTextModalOpen] = useState(false);
  const [manualText, setManualText] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [copySuccess, setCopySuccess] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;

    const qMinutes = query(
      collection(db, 'minutes'),
      where('uid', '==', user.uid),
      orderBy('createdAt', 'desc')
    );

    const unsubscribeMinutes = onSnapshot(qMinutes, (snapshot) => {
      const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Minute));
      setMinutes(docs);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'minutes');
    });

    const qTasks = query(
      collection(db, 'tasks'),
      where('uid', '==', user.uid),
      orderBy('createdAt', 'desc')
    );

    const unsubscribeTasks = onSnapshot(qTasks, (snapshot) => {
      const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Task));
      setTasks(docs);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'tasks');
    });

    return () => {
      unsubscribeMinutes();
      unsubscribeTasks();
    };
  }, [user]);

  useEffect(() => {
    async function testConnection() {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if(error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration. ");
        }
      }
    }
    testConnection();
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const handleLogin = async () => {
    try {
      console.log('Starting Google login...');
      const result = await signInWithPopup(auth, googleProvider);
      console.log('Login successful:', result.user.email);
    } catch (error: any) {
      console.error('Login error code:', error.code);
      console.error('Login error message:', error.message);
      if (error.code === 'auth/popup-closed-by-user') {
        alert('ログイン画面が閉じられました。再度お試しください。');
      } else if (error.code === 'auth/unauthorized-domain') {
        alert('このドメインはFirebaseで許可されていません。Firebaseコンソールの「承認済みドメイン」に現在のドメインを追加してください。');
      } else {
        alert('ログイン中にエラーが発生しました: ' + error.message);
      }
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setActiveTab('home');
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement> | React.DragEvent | string) => {
    if (typeof e !== 'string') e.preventDefault();
    setIsUploading(true);
    setUploadProgress(0);

    let content = '';
    if (typeof e === 'string') {
      content = e;
    } else {
      let files: FileList | null = null;
      if ('target' in e && e.target instanceof HTMLInputElement) {
        files = e.target.files;
      } else if ('dataTransfer' in e) {
        files = (e as React.DragEvent).dataTransfer.files;
      }

      if (!files || files.length === 0) {
        setIsUploading(false);
        return;
      }

      const file = files[0];
      const reader = new FileReader();
      
      content = await new Promise<string>((resolve) => {
        reader.onload = (e) => resolve(e.target?.result as string);
        if (file.type.startsWith('text/')) {
          reader.readAsText(file);
        } else {
          reader.readAsDataURL(file);
        }
      });
    }

    // Simulate upload progress
    const interval = setInterval(() => {
      setUploadProgress(prev => {
        if (prev >= 90) {
          clearInterval(interval);
          return 90;
        }
        return prev + 10;
      });
    }, 200);

    try {
      // Process with Gemini
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [
          {
            parts: [
              { text: `以下の会議データ（テキストまたはBase64）を分析し、以下の厳密なフォーマットで議事録を作成してください。

【フォーマット】
〇〇MTG議事録　（タイトル）　
開催日時：YYYY/MM/DD（曜） 00:00〜（オンライン）
参加者：〇〇(お客様)、〇〇(営業)、〇〇(　)

1.MTG目的：

2.決定事項【重要】：
　①内容：
　　判断者：
　　補足：
　②

3.保留・未確定事項
　①内容：
　　期限：
　②

4.課題
　①内容：
　　期限：
　②

5.Next Action
　①内容：
　　担当：
　　期限：
　②

6.補足メモ
　次回MTG：YYYY/MM/DD（曜） 00:00〜（オンライン）
　内容：

【指示】
- 「〇〇」や「YYYY/MM/DD」などの部分は、会議の内容から推測して埋めてください。
- 該当する内容がないセクションも削除せず、「特になし」などと記載して残してください。
- Googleドキュメントに貼り付けてもそのまま使えるように、インデントや記号（①、　など）を正確に再現してください。
- 出力は以下のJSON形式で返してください:
              {
                "title": "会議のタイトル",
                "summary": "議事録の本文。上記のフォーマットを完全に遵守してください。",
                "tasks": [
                  { "text": "タスク内容", "assignee": "担当者名", "dueDate": "YYYY-MM-DD" }
                ],
                "email": "関係者への共有用メール文面。丁寧な挨拶とお礼、会議の要点、ネクストアクションを含めてください。"
              }` },
              { text: content }
            ]
          }
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              summary: { type: Type.STRING },
              tasks: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    text: { type: Type.STRING },
                    assignee: { type: Type.STRING },
                    dueDate: { type: Type.STRING }
                  }
                }
              },
              email: { type: Type.STRING }
            }
          }
        }
      });

      const result = JSON.parse(response.text || '{}');
      setGeneratedResult(result);

      if (!user) throw new Error('User not authenticated');

      // Save to Firestore
      const minuteRef = await addDoc(collection(db, 'minutes'), {
        title: result.title,
        content: content.substring(0, 1000), // Store preview
        summary: result.summary,
        format: 'unified',
        createdAt: Timestamp.now(),
        uid: user.uid
      });

      if (result.tasks && Array.isArray(result.tasks)) {
        for (const task of result.tasks) {
          await addDoc(collection(db, 'tasks'), {
            minuteId: minuteRef.id,
            text: task.text,
            assignee: task.assignee,
            dueDate: task.dueDate,
            status: 'pending',
            createdAt: Timestamp.now(),
            uid: user.uid
          });
        }
      }

      setUploadProgress(100);
      setTimeout(() => {
        setIsUploading(false);
      }, 500);

    } catch (error) {
      console.error('Error processing file:', error);
      setIsUploading(false);
    }
  };

  const toggleTaskStatus = async (id: string, currentStatus: string) => {
    const newStatus = currentStatus === 'pending' ? 'completed' : 'pending';
    try {
      await updateDoc(doc(db, 'tasks', id), {
        status: newStatus
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `tasks/${id}`);
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/wav' });
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64Audio = reader.result as string;
          handleFileUpload(base64Audio);
        };
        reader.readAsDataURL(audioBlob);
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingTime(0);
      timerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);
    } catch (err) {
      console.error('Error accessing microphone:', err);
      alert('マイクへのアクセスを許可してください。');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (timerRef.current) clearInterval(timerRef.current);
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    });
  };
  const handleManualTextSubmit = () => {
    if (!manualText.trim()) return;
    handleFileUpload(manualText);
    setIsTextModalOpen(false);
    setManualText('');
  };

  const addTaskToMinute = async (minuteId: string, taskText: string, taskData?: { assignee?: string, dueDate?: string }) => {
    if (!taskText.trim() || !user) return;
    try {
      await addDoc(collection(db, 'tasks'), {
        minuteId: minuteId,
        text: taskText,
        assignee: taskData?.assignee || '自分',
        dueDate: taskData?.dueDate || format(new Date(), 'yyyy-MM-dd'),
        status: 'pending',
        createdAt: Timestamp.now(),
        uid: user.uid
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'tasks');
    }
  };

  const reExtractTasks = async (minute: Minute) => {
    setIsReExtracting(true);
    try {
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [
          {
            parts: [
              { text: `以下の議事録本文から、具体的なタスク（Next Action）を抽出してください。
              
              出力は以下のJSON形式の配列で返してください:
              [
                { "text": "タスク内容", "assignee": "担当者名", "dueDate": "YYYY-MM-DD" }
              ]
              
              議事録本文:
              ${minute.summary}` }
            ]
          }
        ],
        config: { responseMimeType: "application/json" }
      });

      const extractedTasks = JSON.parse(response.text || '[]');
      if (Array.isArray(extractedTasks)) {
        for (const task of extractedTasks) {
          await addTaskToMinute(minute.id, task.text, { assignee: task.assignee, dueDate: task.dueDate });
        }
        alert(`${extractedTasks.length}件のタスクを抽出・追加しました。`);
      }
    } catch (error) {
      console.error('Error re-extracting tasks:', error);
      alert('タスクの抽出に失敗しました。');
    } finally {
      setIsReExtracting(false);
    }
  };

  const handleChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim() || isChatLoading) return;

    const userMsg = searchQuery;
    setChatMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setSearchQuery('');
    setIsChatLoading(true);

    try {
      // Context from minutes
      const context = minutes.map(m => `Title: ${m.title}\nSummary: ${m.summary}`).join('\n\n');
      
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [
          {
            parts: [
              { text: `あなたは過去の議事録を検索・回答するアシスタントです。以下の議事録コンテキストに基づいてユーザーの質問に答えてください。
              
              コンテキスト:
              ${context}
              
              質問: ${userMsg}` }
            ]
          }
        ]
      });

      setChatMessages(prev => [...prev, { role: 'ai', content: response.text || '申し訳ありません、情報を取得できませんでした。' }]);
    } catch (error) {
      console.error('Chat error:', error);
    } finally {
      setIsChatLoading(false);
    }
  };

  const handleSearch = () => {
    if (!searchQuery.trim()) return minutes;
    const q = searchQuery.toLowerCase();
    return minutes.filter(m => 
      m.title.toLowerCase().includes(q) || 
      m.summary.toLowerCase().includes(q) || 
      m.content.toLowerCase().includes(q)
    );
  };

  if (!isAuthReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="animate-spin text-brand-indigo" size={48} />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="max-w-md w-full bg-white rounded-3xl shadow-2xl p-12 text-center border border-brand-indigo/5">
          <div className="w-20 h-20 coral-gradient rounded-2xl flex items-center justify-center text-white mx-auto mb-8 shadow-xl">
            <Sparkles size={40} />
          </div>
          <h1 className="text-3xl font-black text-brand-indigo mb-4">AI議事録管理</h1>
          <p className="text-gray-500 mb-10 font-medium">
            会議の音声をAIが分析し、<br />
            完璧な議事録を自動生成します。
          </p>
          <button
            onClick={handleLogin}
            className="w-full bg-brand-indigo text-white py-4 rounded-2xl font-bold flex items-center justify-center gap-3 hover:bg-opacity-90 transition-all shadow-xl shadow-brand-indigo/20"
          >
            <User size={20} />
            Googleでログイン
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col md:flex-row relative bg-brand-cream/50">
      {/* Background Elements */}
      <div className="orb orb-1" />
      <div className="orb orb-2" />
      <div className="dot-grid" />

      {/* Mobile Navigation Overlay */}
      <AnimatePresence>
        {isMenuOpen && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsMenuOpen(false)}
              className="fixed inset-0 bg-brand-indigo/20 backdrop-blur-sm z-[60] md:hidden"
            />
            <motion.div 
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed inset-y-0 left-0 w-72 bg-white z-[70] md:hidden shadow-2xl p-6 flex flex-col"
            >
              <div className="flex items-center justify-between mb-10">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 coral-gradient rounded-xl flex items-center justify-center shadow-lg">
                    <FileText className="text-white" size={24} />
                  </div>
                  <h1 className="text-xl font-black text-brand-indigo">AI議事録管理</h1>
                </div>
                <button onClick={() => setIsMenuOpen(false)} className="p-2 hover:bg-brand-cream rounded-full transition-colors">
                  <X size={24} className="text-brand-indigo" />
                </button>
              </div>
              
              <div className="space-y-2 flex-1">
                <NavButton active={activeTab === 'home'} onClick={() => { setActiveTab('home'); setIsMenuOpen(false); }} icon={<Home size={20} />} label="ホーム" />
                <NavButton active={activeTab === 'create'} onClick={() => { setActiveTab('create'); setIsMenuOpen(false); }} icon={<Plus size={20} />} label="新規作成" />
                <NavButton active={activeTab === 'tasks'} onClick={() => { setActiveTab('tasks'); setIsMenuOpen(false); }} icon={<CheckCircle2 size={20} />} label="タスク管理" />
                <NavButton active={activeTab === 'knowledge'} onClick={() => { setActiveTab('knowledge'); setIsMenuOpen(false); }} icon={<Search size={20} />} label="ナレッジ検索" />
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Navigation Sidebar (Desktop) */}
      <nav className="hidden md:flex z-50 w-64 h-screen fixed left-0 top-0 flex-shrink-0">
        <div className="h-full w-full glass-card border-r border-white/40 flex flex-col p-6">
          {/* Logo Section */}
          <div className="flex items-center gap-3 mb-12">
            <div className="w-10 h-10 coral-gradient rounded-xl flex items-center justify-center shadow-lg flex-shrink-0">
              <FileText className="text-white" size={24} />
            </div>
            <div>
              <h1 className="text-xl font-black tracking-wide text-brand-indigo leading-none">AI議事録管理</h1>
            </div>
          </div>

          {/* Nav Links */}
          <div className="flex flex-col gap-2 flex-1">
            <NavButton active={activeTab === 'home'} onClick={() => setActiveTab('home')} icon={<Home size={20} />} label="ホーム" />
            <NavButton active={activeTab === 'create'} onClick={() => setActiveTab('create')} icon={<Plus size={20} />} label="新規作成" />
            <NavButton active={activeTab === 'tasks'} onClick={() => setActiveTab('tasks')} icon={<CheckCircle2 size={20} />} label="タスク管理" />
            <NavButton active={activeTab === 'knowledge'} onClick={() => setActiveTab('knowledge')} icon={<Search size={20} />} label="ナレッジ検索" />
          </div>

          <div className="mt-auto pt-8 border-t border-brand-indigo/5">
            <div className="flex items-center gap-3 px-4 py-3 bg-brand-indigo/5 rounded-2xl mb-4">
              <div className="w-10 h-10 rounded-full bg-brand-indigo text-white flex items-center justify-center font-bold flex-shrink-0">
                {user.displayName?.[0] || 'U'}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-brand-indigo truncate">{user.displayName}</p>
                <p className="text-[10px] text-gray-400 truncate">{user.email}</p>
              </div>
            </div>
            <button 
              onClick={handleLogout}
              className="w-full flex items-center gap-3 px-4 py-3 text-sm font-bold text-gray-400 hover:text-brand-coral hover:bg-brand-coral/5 rounded-2xl transition-all"
            >
              <LogOut size={20} />
              ログアウト
            </button>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 md:ml-64">
        {/* Mobile Header */}
        <header className="md:hidden sticky top-0 z-40 bg-white/80 backdrop-blur-md border-b border-brand-indigo/5 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button 
              onClick={() => setIsMenuOpen(true)}
              className="p-2 -ml-2 hover:bg-brand-indigo/5 rounded-xl transition-colors"
            >
              <Menu size={24} className="text-brand-indigo" />
            </button>
            <div className="flex items-center gap-2 ml-2">
              <div className="w-8 h-8 coral-gradient rounded-lg flex items-center justify-center shadow-md">
                <FileText className="text-white" size={18} />
              </div>
              <h1 className="text-lg font-black text-brand-indigo">AI議事録管理</h1>
            </div>
          </div>
          <button className="w-10 h-10 rounded-full glass-card flex items-center justify-center text-brand-indigo">
            <Settings size={20} />
          </button>
        </header>

        <main className="flex-1 px-6 py-8 md:px-10 md:py-12 max-w-6xl">
          <header className="mb-10 hidden md:block">
            <h2 className="text-3xl font-black text-brand-indigo tracking-wide">
              {activeTab === 'home' && 'ホーム'}
              {activeTab === 'create' && '新規議事録作成'}
              {activeTab === 'tasks' && 'タスク管理'}
              {activeTab === 'knowledge' && 'ナレッジ検索'}
              {activeTab === 'all-minutes' && '全ての議事録'}
              {activeTab === 'all-tasks' && '全てのタスク'}
            </h2>
            <p className="text-sm opacity-50 mt-1">
              {activeTab === 'home' && '最近の活動とタスクの概要'}
              {activeTab === 'create' && 'AIを使用して会議から価値を抽出します'}
              {activeTab === 'tasks' && 'チームの進捗状況を追跡'}
              {activeTab === 'knowledge' && '過去の知見をAIと対話して検索'}
              {activeTab === 'all-minutes' && '過去に作成された全ての議事録一覧'}
              {activeTab === 'all-tasks' && '抽出された全てのタスク一覧'}
            </p>
          </header>

          <AnimatePresence mode="wait">
          {activeTab === 'home' && (
            <motion.div
              key="home"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-8"
            >
              {/* Hero Stats */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="glass-card rounded-[32px] p-8 flex flex-col justify-between min-h-[200px] relative overflow-hidden group">
                  <div className="absolute top-0 right-0 p-6 opacity-10 group-hover:opacity-20 transition-opacity">
                    <FileText size={80} />
                  </div>
                  <div>
                    <p className="text-sm font-bold opacity-50 mb-1">作成済み議事録</p>
                    <h3 className="text-5xl font-black text-brand-indigo">{minutes.length}</h3>
                  </div>
                  <button 
                    onClick={() => setActiveTab('create')}
                    className="flex items-center gap-2 text-sm font-bold text-brand-coral hover:gap-3 transition-all"
                  >
                    新規作成 <ArrowRight size={16} />
                  </button>
                </div>

                <div className="glass-card rounded-[32px] p-8 flex flex-col justify-between min-h-[200px] relative overflow-hidden group">
                  <div className="absolute top-0 right-0 p-6 opacity-10 group-hover:opacity-20 transition-opacity">
                    <CheckCircle size={80} />
                  </div>
                  <div>
                    <p className="text-sm font-bold opacity-50 mb-1">未完了タスク</p>
                    <h3 className="text-5xl font-black text-brand-indigo">
                      {tasks.filter(t => t.status === 'pending').length}
                    </h3>
                  </div>
                  <button 
                    onClick={() => setActiveTab('tasks')}
                    className="flex items-center gap-2 text-sm font-bold text-brand-indigo hover:gap-3 transition-all"
                  >
                    タスク一覧 <ArrowRight size={16} />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <section>
                  <div className="flex items-center justify-between mb-6">
                    <h2 className="text-xl font-black text-brand-indigo flex items-center gap-2">
                      <History size={24} className="text-brand-coral" />
                      最近の議事録
                    </h2>
                    <button 
                      onClick={() => setActiveTab('all-minutes')}
                      className="text-xs font-bold opacity-40 hover:opacity-100 transition-opacity"
                    >
                      全て見る
                    </button>
                  </div>
                  <div className="space-y-4">
                    {(minutes || []).slice(0, 3).map(minute => (
                      <div 
                        key={minute.id} 
                        onClick={() => setSelectedMinute(minute)}
                        className="glass-card rounded-3xl p-6 hover:translate-x-2 transition-all cursor-pointer group flex items-center gap-6"
                      >
                        <div className="w-14 h-14 rounded-2xl bg-brand-cream flex items-center justify-center text-brand-coral flex-shrink-0 group-hover:coral-gradient group-hover:text-white transition-all">
                          <FileText size={24} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-[10px] font-mono bg-brand-indigo/5 text-brand-indigo px-2 py-0.5 rounded uppercase">
                              {minute.format}
                            </span>
                            <span className="text-[10px] font-mono opacity-40">
                              {minute.createdAt?.toDate ? format(minute.createdAt.toDate(), 'yyyy.MM.dd') : '----.--.--'}
                            </span>
                          </div>
                          <h3 className="font-bold text-brand-indigo truncate">{minute.title}</h3>
                        </div>
                        <ChevronRight size={20} className="opacity-20 group-hover:opacity-100 transition-opacity" />
                      </div>
                    ))}
                    {minutes.length === 0 && (
                      <div className="py-12 text-center glass-card rounded-3xl opacity-50 italic">
                        議事録がまだありません。
                      </div>
                    )}
                  </div>
                </section>

                <section>
                  <div className="flex items-center justify-between mb-6">
                    <h2 className="text-xl font-black text-brand-indigo flex items-center gap-2">
                      <CheckCircle2 size={24} className="text-brand-coral" />
                      優先タスク
                    </h2>
                    <button 
                      onClick={() => setActiveTab('all-tasks')}
                      className="text-xs font-bold opacity-40 hover:opacity-100 transition-opacity"
                    >
                      全て見る
                    </button>
                  </div>
                  <div className="space-y-3">
                    {(tasks || []).filter(t => t.status === 'pending').slice(0, 4).map(task => (
                      <div key={task.id} className="glass-card rounded-2xl p-5 flex items-center gap-4 group hover:bg-white transition-all">
                        <button 
                          onClick={() => toggleTaskStatus(task.id, task.status)}
                          className="w-6 h-6 rounded-lg border-2 border-brand-indigo/10 flex items-center justify-center hover:border-brand-coral transition-colors"
                        >
                          <div className="w-2.5 h-2.5 rounded-sm bg-brand-coral opacity-0 group-hover:opacity-20" />
                        </button>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold text-brand-indigo truncate">{task.text}</p>
                          <p className="text-[10px] opacity-40 mt-0.5">{task.assignee} • {task.dueDate}</p>
                        </div>
                        <div className="w-2 h-2 rounded-full bg-brand-coral" />
                      </div>
                    ))}
                    {tasks.filter(t => t.status === 'pending').length === 0 && (
                      <div className="py-12 text-center glass-card rounded-2xl opacity-50 text-xs">
                        完了していないタスクはありません。
                      </div>
                    )}
                  </div>
                </section>
              </div>
            </motion.div>
          )}

          {activeTab === 'create' && (
            <motion.div
              key="create"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="max-w-4xl"
            >
              {!generatedResult ? (
                <div className="space-y-8">
                  <div 
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={handleFileUpload}
                    className="relative group"
                  >
                    <div className="absolute -inset-1 coral-gradient rounded-[40px] blur opacity-20 group-hover:opacity-40 transition duration-1000 group-hover:duration-200"></div>
                    <label className="relative glass-card rounded-[32px] p-16 flex flex-col items-center justify-center border-2 border-dashed border-brand-indigo/20 cursor-pointer hover:border-brand-coral/50 transition-all">
                      <input type="file" className="hidden" onChange={handleFileUpload} accept="audio/*,text/*,application/pdf,image/*" />
                      <div className="w-20 h-20 bg-brand-cream rounded-full flex items-center justify-center mb-6 shadow-inner">
                        {isUploading ? <Loader2 className="text-brand-coral animate-spin" size={40} /> : <Upload className="text-brand-coral" size={40} />}
                      </div>
                      <p className="text-xl font-bold text-brand-indigo mb-2">ファイルをドロップ</p>
                      <p className="text-sm opacity-50">またはクリックしてファイルを選択</p>
                      
                      {isUploading && (
                        <div className="mt-8 w-full max-w-xs">
                          <div className="h-2 w-full bg-brand-indigo/10 rounded-full overflow-hidden">
                            <motion.div 
                              className="h-full coral-gradient"
                              initial={{ width: 0 }}
                              animate={{ width: `${uploadProgress}%` }}
                            />
                          </div>
                          <p className="text-center text-[10px] font-mono mt-2 uppercase tracking-widest">Processing with AI... {uploadProgress}%</p>
                        </div>
                      )}
                    </label>
                  </div>

                  <div className="flex justify-center gap-8">
                    <QuickAction 
                      icon={isRecording ? <Square size={24} className="text-white" /> : <Mic size={24} />} 
                      label={isRecording ? formatTime(recordingTime) : "音声を録音"} 
                      onClick={isRecording ? stopRecording : startRecording}
                      active={isRecording}
                    />
                    <QuickAction 
                      icon={<FileText size={24} />} 
                      label="テキスト入力" 
                      onClick={() => setIsTextModalOpen(true)}
                    />
                  </div>
                </div>
              ) : (
                <div className="space-y-8 pb-12 relative">
                  {/* Top Right Close Button */}
                  <button 
                    onClick={() => setGeneratedResult(null)} 
                    className="absolute -top-4 -right-4 w-12 h-12 bg-white shadow-xl rounded-full flex items-center justify-center text-brand-indigo hover:scale-110 hover:text-brand-coral transition-all z-10 border border-brand-indigo/5"
                  >
                    <X size={24} />
                  </button>

                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 coral-gradient rounded-xl flex items-center justify-center text-white shadow-lg">
                        <Sparkles size={20} />
                      </div>
                      <div>
                        <h2 className="text-xl font-black text-brand-indigo">AI議事録が完成しました</h2>
                        <p className="text-xs opacity-40 font-bold">内容を確認して保存してください</p>
                      </div>
                    </div>
                    <div className="flex gap-3">
                      <button 
                        onClick={() => copyToClipboard(generatedResult.summary)}
                        className="glass-card px-5 py-2.5 rounded-2xl text-sm font-bold flex items-center gap-2 hover:bg-white transition-all active:scale-95 border border-brand-indigo/5 shadow-sm"
                      >
                        {copySuccess ? <Check size={18} className="text-green-500" /> : <Copy size={18} className="text-brand-coral" />}
                        {copySuccess ? 'コピー完了' : '本文をコピー'}
                      </button>
                      <button 
                        onClick={() => {
                          copyToClipboard(`${window.location.origin}/minutes/${generatedResult.title}`);
                          alert('保存が完了し、共有リンクをコピーしました');
                          setGeneratedResult(null);
                          setActiveTab('home');
                        }}
                        className="coral-gradient text-white px-8 py-2.5 rounded-2xl text-sm font-bold shadow-xl shadow-brand-coral/20 hover:scale-105 transition-transform flex items-center gap-2"
                      >
                        <CheckCircle size={18} /> 保存して完了
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                    <div className="lg:col-span-8 space-y-6">
                      <div className="bg-white rounded-[48px] p-12 md:p-16 shadow-2xl shadow-brand-indigo/10 min-h-[800px] relative border border-brand-indigo/5">
                        <div className="absolute top-16 right-16 opacity-[0.03] pointer-events-none">
                          <FileText size={200} />
                        </div>
                        <div className="max-w-2xl mx-auto">
                          <div className="mb-16 text-center">
                            <div className="inline-block px-4 py-1 rounded-full bg-brand-coral/10 text-brand-coral text-[10px] font-black uppercase tracking-[0.2em] mb-4">
                              Meeting Minutes
                            </div>
                            <h2 className="text-4xl font-black text-brand-indigo leading-tight mb-6">
                              {generatedResult.title}
                            </h2>
                            <div className="h-1 w-20 coral-gradient mx-auto rounded-full mb-8" />
                            <div className="flex items-center justify-center gap-8 text-[10px] font-black opacity-30 tracking-widest">
                              <div className="flex items-center gap-2"><Clock size={12} /> {format(new Date(), 'yyyy.MM.dd')}</div>
                              <div className="flex items-center gap-2"><Home size={12} /> ホーム</div>
                            </div>
                          </div>
                          
                          <div className="prose prose-indigo max-w-none">
                            <div className="markdown-body minutes-document leading-relaxed text-brand-indigo/90">
                              <Markdown>{generatedResult.summary}</Markdown>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="lg:col-span-4 space-y-8">
                      <div className="glass-card rounded-[40px] p-8 border border-white/60 shadow-xl shadow-brand-indigo/5">
                        <div className="flex items-center justify-between mb-8">
                          <h3 className="font-black text-lg flex items-center gap-3 text-brand-indigo">
                            <div className="w-8 h-8 rounded-lg bg-brand-coral/10 flex items-center justify-center text-brand-coral">
                              <CheckCircle2 size={18} />
                            </div>
                            Next Actions
                          </h3>
                          <button 
                            onClick={() => {
                              const taskText = generatedResult.tasks.map(t => `・${t.text} (${t.assignee})`).join('\n');
                              copyToClipboard(taskText);
                              alert('タスク一覧をコピーしました');
                            }}
                            className="text-[10px] font-black text-brand-coral hover:underline"
                          >
                            一括コピー
                          </button>
                        </div>
                        <div className="space-y-4">
                          {(generatedResult?.tasks || []).map((task, i) => (
                            <div key={i} className="bg-white/80 p-5 rounded-[24px] border border-white shadow-sm hover:border-brand-coral/30 transition-all group">
                              <p className="text-sm font-bold text-brand-indigo mb-4 group-hover:text-brand-coral transition-colors leading-snug">{task.text}</p>
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <div className="w-6 h-6 rounded-full bg-brand-cream border border-brand-indigo/5 flex items-center justify-center text-[10px] font-bold text-brand-indigo">
                                    {task.assignee.charAt(0)}
                                  </div>
                                  <span className="text-[10px] font-bold text-brand-indigo/60">{task.assignee}</span>
                                </div>
                                <span className="text-[10px] font-mono opacity-30 font-bold">{task.dueDate}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="glass-card rounded-[40px] p-8 border border-white/60 shadow-xl shadow-brand-indigo/5">
                        <div className="flex items-center justify-between mb-8">
                          <h3 className="font-black text-lg flex items-center gap-3 text-brand-indigo">
                            <div className="w-8 h-8 rounded-lg bg-brand-indigo/10 flex items-center justify-center text-brand-indigo">
                              <Mail size={18} />
                            </div>
                            Share Email
                          </h3>
                          <button 
                            onClick={() => copyToClipboard(generatedResult.email)}
                            className="w-10 h-10 flex items-center justify-center hover:bg-white rounded-xl transition-all text-brand-indigo/40 hover:text-brand-coral"
                          >
                            <Copy size={20} />
                          </button>
                        </div>
                        <div className="bg-white/80 p-6 rounded-[24px] border border-white text-xs leading-relaxed whitespace-pre-wrap font-mono text-brand-indigo/70 max-h-[300px] overflow-y-auto custom-scrollbar">
                          {generatedResult.email}
                        </div>
                        <button className="w-full mt-8 indigo-gradient text-white py-5 rounded-[24px] text-sm font-black flex items-center justify-center gap-3 shadow-xl shadow-brand-indigo/20 hover:scale-[1.02] transition-transform">
                          <Send size={20} /> メールを一括送信
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {activeTab === 'tasks' && (
            <motion.div
              key="tasks"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="max-w-4xl"
            >
              <div className="flex items-center justify-between mb-8">
                <button 
                  onClick={() => setActiveTab('home')}
                  className="flex items-center gap-2 text-sm font-bold text-brand-indigo opacity-50 hover:opacity-100 transition-opacity"
                >
                  <ChevronRight size={16} className="rotate-180" /> ホームに戻る
                </button>
                <div className="relative w-64">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-indigo/30" size={16} />
                  <input 
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="タスクを検索..."
                    className="w-full bg-white/50 border border-brand-indigo/10 rounded-xl py-2 pl-10 pr-4 text-xs focus:outline-none focus:ring-2 focus:ring-brand-coral/50 transition-all"
                  />
                </div>
              </div>
              <div className="flex gap-2 mb-8">
                <button 
                  onClick={() => setTaskFilter('all')}
                  className={cn("px-4 py-2 rounded-xl text-sm font-bold transition-all", taskFilter === 'all' ? "bg-white shadow-sm" : "glass-card opacity-50")}
                >
                  全て
                </button>
                <button 
                  onClick={() => setTaskFilter('pending')}
                  className={cn("px-4 py-2 rounded-xl text-sm font-bold transition-all", taskFilter === 'pending' ? "bg-white shadow-sm" : "glass-card opacity-50")}
                >
                  未完了
                </button>
                <button 
                  onClick={() => setTaskFilter('completed')}
                  className={cn("px-4 py-2 rounded-xl text-sm font-bold transition-all", taskFilter === 'completed' ? "bg-white shadow-sm" : "glass-card opacity-50")}
                >
                  完了済み
                </button>
              </div>

              <div className="space-y-10">
                {/* Pending Section */}
                {(taskFilter === 'all' || taskFilter === 'pending') && (
                  <div className="space-y-4">
                    <div className="flex items-center gap-3 px-2">
                      <div className="w-2 h-2 rounded-full bg-brand-coral" />
                      <h4 className="text-xs font-black text-brand-indigo/40 uppercase tracking-widest">未完了</h4>
                    </div>
                    {tasks.filter(t => (taskFilter === 'all' || taskFilter === 'pending') && t.status === 'pending' && (t.text.toLowerCase().includes(searchQuery.toLowerCase()))).map(task => (
                      <div key={task.id} className="glass-card rounded-3xl p-6 flex items-center gap-6 transition-all hover:bg-white">
                        <button 
                          onClick={() => toggleTaskStatus(task.id, task.status)}
                          className="w-8 h-8 rounded-xl border-2 border-brand-indigo/20 flex items-center justify-center transition-all hover:border-brand-coral"
                        >
                          <div className="w-3 h-3 rounded-sm bg-brand-coral opacity-0 group-hover:opacity-20" />
                        </button>
                        <div className="flex-1">
                          <h3 className="font-bold text-lg text-brand-indigo">{task.text}</h3>
                          <div className="flex items-center gap-4 mt-2">
                            <span className="text-xs font-mono opacity-50 flex items-center gap-1">
                              <User size={12} /> {task.assignee}
                            </span>
                            <span className="text-xs font-mono opacity-50 flex items-center gap-1">
                              <Calendar size={12} /> {task.dueDate}
                            </span>
                          </div>
                        </div>
                        <button className="text-brand-indigo/30 hover:text-brand-coral transition-colors">
                          <Trash2 size={20} />
                        </button>
                      </div>
                    ))}
                    {tasks.filter(t => t.status === 'pending').length === 0 && (
                      <div className="py-12 text-center glass-card rounded-3xl opacity-30 text-sm italic">
                        未完了のタスクはありません。
                      </div>
                    )}
                  </div>
                )}

                {/* Completed Section */}
                {(taskFilter === 'all' || taskFilter === 'completed') && (
                  <div className="space-y-4">
                    <div className="flex items-center gap-3 px-2">
                      <div className="w-2 h-2 rounded-full bg-green-500" />
                      <h4 className="text-xs font-black text-brand-indigo/40 uppercase tracking-widest">完了済み</h4>
                    </div>
                    {tasks.filter(t => (taskFilter === 'all' || taskFilter === 'completed') && t.status === 'completed' && (t.text.toLowerCase().includes(searchQuery.toLowerCase()))).map(task => (
                      <div key={task.id} className="glass-card rounded-3xl p-6 flex items-center gap-6 transition-all opacity-50 grayscale bg-brand-indigo/[0.02]">
                        <button 
                          onClick={() => toggleTaskStatus(task.id, task.status)}
                          className="w-8 h-8 rounded-xl bg-green-500 border-2 border-green-500 text-white flex items-center justify-center transition-all"
                        >
                          <Check size={16} />
                        </button>
                        <div className="flex-1">
                          <h3 className="font-bold text-lg text-brand-indigo line-through">{task.text}</h3>
                          <div className="flex items-center gap-4 mt-2">
                            <span className="text-xs font-mono opacity-50 flex items-center gap-1">
                              <User size={12} /> {task.assignee}
                            </span>
                            <span className="text-xs font-mono opacity-50 flex items-center gap-1">
                              <Calendar size={12} /> {task.dueDate}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                    {tasks.filter(t => t.status === 'completed').length === 0 && (
                      <div className="py-12 text-center glass-card rounded-3xl opacity-30 text-sm italic">
                        完了済みのタスクはありません。
                      </div>
                    )}
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {activeTab === 'knowledge' && (
            <motion.div
              key="knowledge"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="max-w-4xl h-[70vh] flex flex-col"
            >
              <div className="flex-1 glass-card rounded-[40px] p-6 mb-6 overflow-hidden flex flex-col">
                <div className="flex-1 overflow-y-auto space-y-6 pr-4 custom-scrollbar">
                  {(chatMessages || []).length === 0 && (
                    <div className="h-full flex flex-col items-center justify-center opacity-30 text-center space-y-4">
                      <Search size={64} />
                      <p className="text-lg italic">「あの件、どう決まったっけ？」<br/>と聞いてみてください</p>
                    </div>
                  )}
                  {(chatMessages || []).map((msg, i) => (
                    <div key={i} className={cn(
                      "flex flex-col max-w-[80%]",
                      msg.role === 'user' ? "ml-auto items-end" : "mr-auto items-start"
                    )}>
                      <div className={cn(
                        "p-4 rounded-2xl text-sm leading-relaxed",
                        msg.role === 'user' 
                          ? "coral-gradient text-white shadow-lg shadow-brand-coral/20 rounded-tr-none" 
                          : "bg-white shadow-sm border border-brand-indigo/5 rounded-tl-none"
                      )}>
                        {msg.content}
                      </div>
                      <span className="text-[10px] font-mono opacity-40 mt-1 uppercase tracking-widest">
                        {msg.role === 'user' ? 'You' : 'AIアシスタント'}
                      </span>
                    </div>
                  ))}
                  {isChatLoading && (
                    <div className="flex items-center gap-2 text-brand-coral animate-pulse">
                      <Loader2 className="animate-spin" size={16} />
                      <span className="text-xs font-bold">AIが思考中...</span>
                    </div>
                  )}
                </div>

                <form onSubmit={handleChat} className="mt-6 relative">
                  <input 
                    type="text" 
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="過去の決定事項や保留事項について質問..."
                    className="w-full bg-white/50 border border-brand-indigo/10 rounded-2xl py-4 pl-6 pr-16 focus:outline-none focus:ring-2 focus:ring-brand-coral/50 transition-all placeholder:opacity-30"
                  />
                  <button 
                    type="submit"
                    disabled={isChatLoading}
                    className="absolute right-2 top-1/2 -translate-y-1/2 w-12 h-12 coral-gradient text-white rounded-xl flex items-center justify-center shadow-lg hover:scale-105 transition-transform disabled:opacity-50"
                  >
                    <Send size={20} />
                  </button>
                </form>
              </div>
            </motion.div>
          )}

          {activeTab === 'all-minutes' && (
            <motion.div
              key="all-minutes"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-6"
            >
              <div className="flex items-center justify-between mb-8">
                <button 
                  onClick={() => setActiveTab('home')}
                  className="flex items-center gap-2 text-sm font-bold text-brand-indigo opacity-50 hover:opacity-100 transition-opacity"
                >
                  <ChevronRight size={16} className="rotate-180" /> ホームに戻る
                </button>
                <div className="relative w-64">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-indigo/30" size={16} />
                  <input 
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="議事録を検索..."
                    className="w-full bg-white/50 border border-brand-indigo/10 rounded-xl py-2 pl-10 pr-4 text-xs focus:outline-none focus:ring-2 focus:ring-brand-coral/50 transition-all"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {handleSearch().map(minute => (
                  <div 
                    key={minute.id} 
                    onClick={() => setSelectedMinute(minute)}
                    className="glass-card rounded-3xl p-6 hover:translate-y-[-4px] transition-all cursor-pointer group flex items-center gap-6"
                  >
                    <div className="w-14 h-14 rounded-2xl bg-brand-cream flex items-center justify-center text-brand-coral flex-shrink-0 group-hover:coral-gradient group-hover:text-white transition-all">
                      <FileText size={24} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[10px] font-mono bg-brand-indigo/5 text-brand-indigo px-2 py-0.5 rounded uppercase">
                          {minute.format}
                        </span>
                        <span className="text-[10px] font-mono opacity-40">
                          {minute.createdAt?.toDate ? format(minute.createdAt.toDate(), 'yyyy.MM.dd') : '----.--.--'}
                        </span>
                      </div>
                      <h3 className="font-bold text-brand-indigo truncate">{minute.title}</h3>
                    </div>
                    <ChevronRight size={20} className="opacity-20 group-hover:opacity-100 transition-opacity" />
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {activeTab === 'all-tasks' && (
            <motion.div
              key="all-tasks"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-6"
            >
              <div className="flex items-center justify-between mb-8">
                <button 
                  onClick={() => setActiveTab('home')}
                  className="flex items-center gap-2 text-sm font-bold text-brand-indigo opacity-50 hover:opacity-100 transition-opacity"
                >
                  <ChevronRight size={16} className="rotate-180" /> ホームに戻る
                </button>
              </div>
              <div className="space-y-3">
                {tasks.map(task => (
                  <div key={task.id} className={cn(
                    "glass-card rounded-2xl p-5 flex items-center gap-4 group hover:bg-white transition-all",
                    task.status === 'completed' && "opacity-50"
                  )}>
                    <button 
                      onClick={() => toggleTaskStatus(task.id, task.status)}
                      className={cn(
                        "w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-all",
                        task.status === 'completed' ? "bg-green-500 border-green-500 text-white" : "border-brand-indigo/10 hover:border-brand-coral"
                      )}
                    >
                      {task.status === 'completed' && <Check size={14} />}
                    </button>
                    <div className="flex-1 min-w-0">
                      <p className={cn("text-sm font-bold text-brand-indigo truncate", task.status === 'completed' && "line-through")}>{task.text}</p>
                      <p className="text-[10px] opacity-40 mt-0.5">{task.assignee} • {task.dueDate}</p>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Text Input Modal */}
        <AnimatePresence>
          {isTextModalOpen && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setIsTextModalOpen(false)}
                className="absolute inset-0 bg-brand-indigo/20 backdrop-blur-sm"
              />
              <motion.div 
                initial={{ opacity: 0, scale: 0.9, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: 20 }}
                className="relative w-full max-w-2xl glass-card rounded-[32px] p-8 shadow-2xl"
              >
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-xl font-black text-brand-indigo">テキストを直接入力</h3>
                  <button onClick={() => setIsTextModalOpen(false)} className="p-2 hover:bg-brand-cream rounded-full transition-colors">
                    <X size={20} />
                  </button>
                </div>
                <textarea 
                  value={manualText}
                  onChange={(e) => setManualText(e.target.value)}
                  placeholder="会議のメモや文字起こしテキストをここに貼り付けてください..."
                  className="w-full h-64 bg-white/50 border border-brand-indigo/10 rounded-2xl p-6 focus:outline-none focus:ring-2 focus:ring-brand-coral/50 transition-all resize-none mb-6"
                />
                <div className="flex justify-end gap-4">
                  <button 
                    onClick={() => setIsTextModalOpen(false)}
                    className="px-6 py-3 rounded-xl font-bold opacity-50 hover:opacity-100 transition-opacity"
                  >
                    キャンセル
                  </button>
                  <button 
                    onClick={handleManualTextSubmit}
                    disabled={!manualText.trim()}
                    className="coral-gradient text-white px-8 py-3 rounded-xl font-bold shadow-lg shadow-brand-coral/20 hover:scale-105 transition-transform disabled:opacity-50 disabled:scale-100"
                  >
                    議事録を作成
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Minute Detail Modal */}
        <AnimatePresence>
          {selectedMinute && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 overflow-y-auto">
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setSelectedMinute(null)}
                className="fixed inset-0 bg-brand-indigo/40 backdrop-blur-md"
              />
              <motion.div 
                initial={{ opacity: 0, y: 50, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 50, scale: 0.95 }}
                className="relative w-full max-w-5xl bg-brand-cream rounded-[48px] shadow-2xl overflow-hidden flex flex-col max-h-[90vh] border border-brand-indigo/10"
              >
                {/* Top Right Close Button */}
                <button 
                  onClick={() => setSelectedMinute(null)} 
                  className="absolute top-6 right-6 w-12 h-12 bg-white shadow-xl rounded-full flex items-center justify-center text-brand-indigo hover:scale-110 hover:text-brand-coral transition-all z-10 border border-brand-indigo/5"
                >
                  <X size={24} />
                </button>

                <div className="flex items-center justify-between p-10 bg-white/80 backdrop-blur-md border-b border-brand-indigo/5">
                  <div className="flex items-center gap-6">
                    <div className="w-16 h-16 rounded-2xl bg-brand-cream flex items-center justify-center text-brand-coral">
                      <FileText size={32} />
                    </div>
                    <div>
                      <h3 className="text-2xl font-black text-brand-indigo leading-tight">{selectedMinute.title}</h3>
                      <div className="flex items-center gap-4 mt-2">
                        <span className="text-[10px] font-black opacity-30 font-mono uppercase tracking-widest">{selectedMinute.createdAt?.toDate ? format(selectedMinute.createdAt.toDate(), 'yyyy.MM.dd HH:mm') : '----.--.-- --:--'}</span>
                        <div className="w-1 h-1 rounded-full bg-brand-indigo/20" />
                        <span className="text-[10px] font-black text-brand-coral uppercase tracking-widest">{selectedMinute.format}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-4 pr-16">
                    <button 
                      onClick={() => copyToClipboard(selectedMinute.summary)}
                      className="glass-card px-6 py-3 rounded-2xl text-sm font-black flex items-center gap-2 hover:bg-white transition-all active:scale-95 border border-brand-indigo/5 shadow-sm"
                    >
                      {copySuccess ? <Check size={20} className="text-green-500" /> : <Copy size={20} className="text-brand-coral" />}
                      本文をコピー
                    </button>
                    <button 
                      onClick={() => {
                        copyToClipboard(`${window.location.origin}/share/${selectedMinute.id}`);
                        alert('共有用URLをコピーしました');
                      }}
                      className="coral-gradient text-white px-8 py-3 rounded-2xl text-sm font-black shadow-xl shadow-brand-coral/20 hover:scale-105 transition-transform"
                    >
                      共有する
                    </button>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-10 md:p-16">
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
                    <div className="lg:col-span-8">
                      <div className="bg-white rounded-[40px] p-12 md:p-16 shadow-sm min-h-[700px] border border-brand-indigo/5">
                        <div className="prose prose-indigo max-w-none">
                          <div className="markdown-body minutes-document leading-relaxed text-brand-indigo/90">
                            <Markdown>{selectedMinute.summary}</Markdown>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="lg:col-span-4 space-y-10">
                      <section>
                        <div className="flex items-center justify-between mb-6">
                          <h4 className="text-base font-black text-brand-indigo flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg bg-brand-coral/10 flex items-center justify-center text-brand-coral">
                              <CheckCircle2 size={18} />
                            </div>
                            Tasks
                          </h4>
                          <button 
                            disabled={isReExtracting}
                            className={cn(
                              "text-[10px] font-black text-brand-coral hover:underline flex items-center gap-1 disabled:opacity-50",
                              isReExtracting && "animate-pulse"
                            )}
                            onClick={() => reExtractTasks(selectedMinute)}
                          >
                            <Sparkles size={12} /> {isReExtracting ? '抽出中...' : 'AI再抽出'}
                          </button>
                        </div>
                        <div className="space-y-4">
                          {tasks.filter(t => t.minuteId === selectedMinute.id).map(task => (
                            <div key={task.id} className="bg-white/80 p-5 rounded-[24px] border border-white shadow-sm flex items-start gap-4 group">
                              <button 
                                onClick={() => toggleTaskStatus(task.id, task.status)}
                                className={cn(
                                  "mt-0.5 w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-all flex-shrink-0",
                                  task.status === 'completed' ? "bg-green-500 border-green-500 text-white" : "border-brand-indigo/10 group-hover:border-brand-coral"
                                )}
                              >
                                {task.status === 'completed' && <Check size={14} strokeWidth={4} />}
                              </button>
                              <div className="flex-1 min-w-0">
                                <span className={cn("text-sm font-bold block leading-snug", task.status === 'completed' ? "line-through opacity-30" : "text-brand-indigo")}>
                                  {task.text}
                                </span>
                                <div className="flex items-center gap-2 mt-2 opacity-40 text-[10px] font-bold">
                                  <span>{task.assignee}</span>
                                  <span>•</span>
                                  <span>{task.dueDate}</span>
                                </div>
                              </div>
                            </div>
                          ))}
                          <div className="pt-4">
                            <form 
                              onSubmit={(e) => {
                                e.preventDefault();
                                const input = e.currentTarget.elements.namedItem('newTask') as HTMLInputElement;
                                addTaskToMinute(selectedMinute.id, input.value);
                                input.value = '';
                              }}
                              className="relative"
                            >
                              <input 
                                name="newTask"
                                type="text" 
                                placeholder="新しいタスクをクイック追加..."
                                className="w-full bg-white/60 border border-brand-indigo/5 rounded-[20px] py-4 pl-6 pr-14 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-brand-coral/30 transition-all shadow-sm"
                              />
                              <button type="submit" className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 coral-gradient text-white rounded-xl flex items-center justify-center shadow-lg hover:scale-110 transition-transform">
                                <Plus size={20} strokeWidth={3} />
                              </button>
                            </form>
                          </div>
                        </div>
                      </section>

                      <section>
                        <h4 className="text-base font-black text-brand-indigo mb-6 flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-brand-indigo/10 flex items-center justify-center text-brand-indigo">
                            <Clock size={18} />
                          </div>
                          Information
                        </h4>
                        <div className="glass-card rounded-[32px] p-8 space-y-6 border border-white/60">
                          <div className="flex justify-between items-center">
                            <span className="text-[10px] font-black opacity-30 uppercase tracking-widest">Format</span>
                            <span className="text-xs font-black text-brand-indigo bg-brand-indigo/5 px-3 py-1 rounded-full">{selectedMinute.format.toUpperCase()}</span>
                          </div>
                          <div className="h-px bg-brand-indigo/5" />
                          <div className="flex justify-between items-center">
                            <span className="text-[10px] font-black opacity-30 uppercase tracking-widest">Created</span>
                            <span className="text-xs font-black text-brand-indigo">{selectedMinute.createdAt?.toDate ? format(selectedMinute.createdAt.toDate(), 'yyyy/MM/dd') : '----/--/--'}</span>
                          </div>
                          <div className="h-px bg-brand-indigo/5" />
                          <div className="flex justify-between items-center">
                            <span className="text-[10px] font-black opacity-30 uppercase tracking-widest">Status</span>
                            <span className="flex items-center gap-2 text-xs font-black text-green-600">
                              <div className="w-2 h-2 rounded-full bg-green-500" /> Archived
                            </span>
                          </div>
                        </div>
                      </section>
                    </div>
                  </div>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </main>
    </div>
  </div>
  );
}

function NavButton({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "flex items-center gap-3 px-4 py-3 rounded-2xl transition-all relative w-full",
        active ? "text-brand-coral" : "text-brand-indigo opacity-50 hover:opacity-100 hover:bg-white/40"
      )}
    >
      {active && (
        <motion.div 
          layoutId="nav-active"
          className="absolute inset-0 bg-white rounded-2xl shadow-sm -z-10"
        />
      )}
      <div className={cn(
        "w-8 h-8 rounded-lg flex items-center justify-center transition-colors",
        active ? "bg-brand-coral/10" : "bg-transparent"
      )}>
        {icon}
      </div>
      <span className="text-sm font-bold tracking-wide">{label}</span>
      {active && (
        <motion.div 
          layoutId="nav-indicator"
          className="ml-auto w-1.5 h-1.5 rounded-full bg-brand-coral"
        />
      )}
    </button>
  );
}

function QuickAction({ icon, label, onClick, active }: { icon: React.ReactNode, label: string, onClick?: () => void, active?: boolean }) {
  return (
    <button 
      onClick={onClick}
      className="flex flex-col items-center gap-2 group"
    >
      <div className={cn(
        "w-16 h-16 glass-card rounded-2xl flex items-center justify-center transition-all shadow-sm relative overflow-hidden",
        active 
          ? "coral-gradient text-white scale-110 shadow-lg shadow-brand-coral/30" 
          : "text-brand-indigo group-hover:bg-white group-hover:scale-105"
      )}>
        {active && (
          <motion.div 
            animate={{ scale: [1, 1.2, 1] }}
            transition={{ repeat: Infinity, duration: 2 }}
            className="absolute inset-0 bg-white/20"
          />
        )}
        {icon}
      </div>
      <span className={cn(
        "text-xs font-bold transition-opacity",
        active ? "text-brand-coral opacity-100" : "opacity-40 group-hover:opacity-100"
      )}>{label}</span>
    </button>
  );
}
