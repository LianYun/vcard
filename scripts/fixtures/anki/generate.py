from pathlib import Path
from anki.collection import Collection
from anki.import_export_pb2 import ExportAnkiPackageOptions
import base64,wave
root=Path('/tmp/vibe-anki-fixtures');root.mkdir(exist_ok=True)
col=Collection(str(root/'collection.anki2'))
parent=col.decks.id('English::Words'); listening=col.decks.id('English::Listening')
media=Path(col.media.dir())
(media/'pixel.png').write_bytes(base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jvS8AAAAASUVORK5CYII='))
with wave.open(str(media/'sound.wav'),'wb') as w:w.setnchannels(1);w.setsampwidth(2);w.setframerate(8000);w.writeframes(b'\0\0'*800)
note=col.new_note(col.models.by_name('Basic'));note['Front']='hello <img src="pixel.png">';note['Back']='你好 [sound:sound.wav]';note.tags=['English','greeting'];col.add_note(note,parent)
note=col.new_note(col.models.by_name('Cloze'));note['Text']='{{c1::Canberra::city}} was founded in {{c2::1913}}. {{c1::Capital}}';note['Back Extra']='图片 <img src="pixel.png"> [sound:sound.wav]';col.add_note(note,listening)
for legacy in [True,False]:
 col.export_anki_package(out_path=str(root/('legacy.apkg' if legacy else 'modern.apkg')),options=ExportAnkiPackageOptions(with_scheduling=False,with_deck_configs=False,with_media=True,legacy=legacy),limit=None)
print('cards',col.card_count())
col.close()
