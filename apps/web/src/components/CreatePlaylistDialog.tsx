import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Modal } from './Modal';
import { api } from '../api';
import { useUiStore } from '../store/ui';
import { useToastStore } from '../store/toast';

export function CreatePlaylistDialog() {
  const open = useUiStore((state) => state.createPlaylistOpen);
  const close = useUiStore((state) => state.closeCreatePlaylist);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const pushToast = useToastStore((state) => state.push);

  useEffect(() => {
    if (open) {
      setName('');
      setDescription('');
      setError(null);
    }
  }, [open]);

  const mutation = useMutation({
    mutationFn: () => api.createPlaylist({ name: name.trim(), description: description.trim() }),
    onSuccess: async (playlist) => {
      await queryClient.invalidateQueries({ queryKey: ['playlists'] });
      close();
      pushToast('Çalma listesi oluşturuldu.');
      navigate(`/playlist/${playlist.id}`);
    },
    onError: (mutationError) => {
      setError(mutationError instanceof Error ? mutationError.message : 'Liste oluşturulamadı.');
    },
  });

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      setError('Listeye bir ad ver.');
      return;
    }
    mutation.mutate();
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="Yeni çalma listesi"
      description="Kendi sıralamanı oluştur, istediğin parçaları ekle."
      footer={
        <>
          <button type="button" className="button ghost" onClick={close}>
            Vazgeç
          </button>
          <button type="submit" form="create-playlist-form" className="button primary" disabled={mutation.isPending}>
            {mutation.isPending ? 'Oluşturuluyor…' : 'Oluştur'}
          </button>
        </>
      }
    >
      <form id="create-playlist-form" className="form" onSubmit={submit}>
        <label>
          <span>Liste adı</span>
          <input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={80}
            placeholder="Örn. Gece sürüşü"
          />
        </label>
        <label>
          <span>Açıklama <small>(isteğe bağlı)</small></span>
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={500}
            rows={3}
            placeholder="Bu liste ne için?"
          />
        </label>
        {error ? <p className="form-error">{error}</p> : null}
      </form>
    </Modal>
  );
}
