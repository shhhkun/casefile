'use client';

import { useState } from 'react';

export default function Home() {
  const [url, setUrl] = useState('');
  const [transcript, setTranscript] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    setLoading(true);
    setError('');
    setTranscript('');

    try {
      const res = await fetch('/api/transcript', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error);
        return;
      }

      setTranscript(data.transcript);

    } catch (err) {
      setError('Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="p-8">
      <input
        type="text"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="Paste YouTube URL"
        className="border p-2 w-full mb-4"
      />
      <button
        onClick={handleSubmit}
        disabled={loading}
        className="bg-black text-white px-4 py-2"
      >
        {loading ? 'Loading...' : 'Fetch Transcript'}
      </button>
      {error && <p className="text-red-500 mt-4">{error}</p>}
      {transcript && (
        <pre className="mt-4 text-sm whitespace-pre-wrap">{transcript}</pre>
      )}
    </main>
  );
}