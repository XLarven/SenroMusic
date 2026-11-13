import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, ListPlus, Loader2, Plus } from 'lucide-react';
import clsx from 'clsx';
import { api } from '../api';
import { useMusicData } from '../MusicDataContext';
import { useToastStore } from '../store/toast';
import { formatDuration } from '../lib/format';
import { Cover } from './Cover';
import { Modal } from './Modal';
import type { Track } from '../types';

type AddToPlaylistMenuProps = {
  track: Track;
  className?: string;
  label?: string;
};

export function AddToPlaylistMenu({ track, className, label }: AddToPlaylistMenuProps) {
  const [open, setOpen] = useState(false);
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const { playlists } = useMusicData();
  const queryClient = useQueryClient();
  const pushToast = useToastStore((state) => state.push);

  useEffect(() => {
    if (!open) {
      setAddingTo(null);
      setNewName('');
      setFormError(null);
    }
  }, [open]);

  const invalidatePlaylists = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['playlists'] }),
      queryClient.invalidateQueries({ queryKey: ['playlist'] }),
    ]);
  };

  const addMutation = useMutation({
    mutationFn: (playlistId: string) => api.addTrack(playlistId, track.id, track),
    onMutate: (playlistId) => setAddingTo(playlistId),
    onSuccess: async (_result, playlistId) => {
      await invalidatePlaylists();
      const playlist = playlists.find((entry) => entry.id === playlistId);
      pushToast(playlist ? `“${track.title}” ${playlist.name} listesine eklendi.` : 'Parça listeye eklendi.');
      setOpen(false);
    },
    onError: (error) => {
      setFormError(error instanceof Error ? error.message : 'Parça listeye eklenemedi.');
    },
    onSettled: () => setAddingTo(null),
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const playlist = await api.createPlaylist({ name: newName.trim() });
      await api.addTrack(playlist.id, track.id);
      return playlist;
    },
    onSuccess: async (playlist) => {
      await invalidatePlaylists();
      pushToast(`“${playlist.name}” oluşturuldu ve parça eklendi.`);
      setOpen(false);
    },
    onError: (error) => {
      setFormError(error instanceof Error ? error.message : 'Liste oluşturulamadı.');
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);
    if (!newName.trim()) {
      setFormError('Yeni listeye bir ad ver.');
      return;
    }
    createMutation.mutate();
  };

  const busy = addMutation.isPending || createMutation.isPending;

  return (
    <>
      <button
        type="button"
        className={clsx('icon-button subtle track-action', className)}
        onClick={(event) => {
          event.stopPropagation();
          setOpen(true);
        }}
        aria-label={label ?? `“${track.title}” parçasını çalma listesine ekle`}
        title={label ?? 'Çalma listesine ekle'}
      >
        <ListPlus size={17} />
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Çalma listesine ekle"
        description={`“${track.title}” için bir liste seç.`}
        footer={
          <button type="button" className="button ghost" onClick={() => setOpen(false)}>
            Kapat
          </button>
        }
      >
        <div className="add-to-list">
          {playlists.length > 0 ? (
            <div className="add-to-list-options">
              {playlists.map((playlist) => (
                <button
                  type="button"
                  key={playlist.id}
                  className="add-to-list-option"
                  disabled={busy}
                  onClick={() => {
                    setFormError(null);
                    addMutation.mutate(playlist.id);
                  }}
                >
                  <Cover
                    src={playlist.coverUrl}
                    seed={playlist.id}
                    alt=""
                    className="add-to-list-cover"
                    iconSize={16}
                  />
                  <span className="add-to-list-copy">
                    <strong>{playlist.name}</strong>
                    <small>
                      {playlist.trackCount} parça · {formatDuration(playlist.duration)}
                    </small>
                  </span>
                  {addingTo === playlist.id ? (
                    <Loader2 size={17} className="spin" />
                  ) : (
                    <Plus size={17} />
                  )}
                </button>
              ))}
            </div>
          ) : (
            <div className="add-to-list-empty">
              <ListPlus size={22} />
              <p>Henüz çalma listen yok. Aşağıdan ilk listeni oluştur.</p>
            </div>
          )}

          <form className="add-to-list-create" onSubmit={submit}>
            <label htmlFor={`new-list-${track.id}`}>Yeni liste oluştur</label>
            <div className="inline-field">
              <input
                id={`new-list-${track.id}`}
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                maxLength={80}
                placeholder="Liste adı"
                disabled={busy}
              />
              <button type="submit" className="button secondary compact" disabled={busy || !newName.trim()}>
                {createMutation.isPending ? <Loader2 size={16} className="spin" /> : <Check size={16} />}
                Oluştur ve ekle
              </button>
            </div>
          </form>
          {formError ? <p className="form-error">{formError}</p> : null}
        </div>
      </Modal>
    </>
  );
}
