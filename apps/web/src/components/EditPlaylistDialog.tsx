import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Trash2 } from 'lucide-react';
import { api } from '../api';
import { useToastStore } from '../store/toast';
import { Modal } from './Modal';
import type { Playlist } from '../types';

type EditPlaylistDialogProps = {
  playlist: Playlist;
  open: boolean;
  onClose: () => void;
};

export function EditPlaylistDialog({ playlist, open, onClose }: EditPlaylistDialogProps) {
  const [name, setName] = useState(playlist.name);
  const [description, setDescription] = useState(playlist.description);
  const [visibility, setVisibility] = useState<'private' | 'public'>(playlist.visibility);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const pushToast = useToastStore((state) => state.push);

  useEffect(() => {
    if (open) {
      setName(playlist.name);
      setDescription(playlist.description);
      setVisibility(playlist.visibility);
      setError(null);
      setConfirmDelete(false);
    }
  }, [open, playlist.name, playlist.description, playlist.visibility]);

  const saveMutation = useMutation({
    mutationFn: () =>
      api.updatePlaylist(playlist.id, {
        name: name.trim(),
        description: description.trim(),
        visibility,
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['playlist', playlist.id] }),
        queryClient.invalidateQueries({ queryKey: ['playlists'] }),
      ]);
      pushToast('Çalma listesi güncellendi.');
      onClose();
    },
    onError: (mutationError) => {
      setError(mutationError instanceof Error ? mutationError.message : 'Liste güncellenemedi.');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.deletePlaylist(playlist.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['playlists'] });
      queryClient.removeQueries({ queryKey: ['playlist', playlist.id] });
      pushToast('Çalma listesi silindi.', 'info');
      onClose();
      navigate('/library?tab=playlists');
    },
    onError: (mutationError) => {
      setError(mutationError instanceof Error ? mutationError.message : 'Liste silinemedi.');
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError('Listeye bir ad ver.');
      return;
    }
    saveMutation.mutate();
  };

  const busy = saveMutation.isPending || deleteMutation.isPending;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Çalma listesini düzenle"
      description="Adı ve açıklamayı güncelle ya da listeyi kalıcı olarak sil."
      footer={
        <>
          <button type="button" className="button ghost" onClick={onClose} disabled={busy}>
            Vazgeç
          </button>
          <button type="submit" form="edit-playlist-form" className="button primary" disabled={busy}>
            {saveMutation.isPending ? <Loader2 size={16} className="spin" /> : null}
            Kaydet
          </button>
        </>
      }
    >
      <form id="edit-playlist-form" className="form" onSubmit={submit}>
        <label>
          <span>Liste adı</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={80}
            disabled={busy}
          />
        </label>
        <label>
          <span>
            Açıklama <small>(isteğe bağlı)</small>
          </span>
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={3}
            maxLength={500}
            disabled={busy}
          />
        </label>
        <label>
          <span>Görünürlük</span>
          <select value={visibility} onChange={(event) => setVisibility(event.target.value as 'private' | 'public')} disabled={busy}>
            <option value="private">Özel — yalnızca sen görürsün</option>
            <option value="public">Herkese açık — giriş yapanlar görebilir</option>
          </select>
        </label>
        {error ? <p className="form-error">{error}</p> : null}
      </form>

      <div className="danger-zone">
        <div>
          <strong>Tehlikeli alan</strong>
          <p>Liste silinir; müzik dosyalarına dokunulmaz.</p>
        </div>
        {confirmDelete ? (
          <div className="danger-actions">
            <button type="button" className="button ghost compact" onClick={() => setConfirmDelete(false)} disabled={busy}>
              Vazgeç
            </button>
            <button
              type="button"
              className="button danger compact"
              onClick={() => deleteMutation.mutate()}
              disabled={busy}
            >
              {deleteMutation.isPending ? <Loader2 size={15} className="spin" /> : <Trash2 size={15} />}
              Evet, sil
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="button danger ghost-danger compact"
            onClick={() => setConfirmDelete(true)}
            disabled={busy}
          >
            <Trash2 size={15} />
            Listeyi sil
          </button>
        )}
      </div>
    </Modal>
  );
}
