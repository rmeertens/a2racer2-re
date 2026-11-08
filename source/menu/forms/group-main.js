// The way from the intro to the race: TfrmIntro, TfrmMainScreen, TfrmDifficulty, TfrmQuickRace,
// TfrmCurrentChar, TfrmCharacter, TfrmTrack and TfrmTrackIntro. Addresses are menu.exe.
// Specification: docs/research/menu-forms.md sections 5, 10 and 12.
// Form classes of the other groups are used only at run time, so the import cycle does no harm.
import { OneWayScreen, TwoWayScreen, GameMenuScreen, loadDfm } from '../base-forms.js';
import { Form, ImageBox } from '../framework.js';
import * as forms from './index.js';

/** FUN_00480b08: two digits at least. */
const two = (n) => String(n).padStart(2, '0');

/**
 * GetImgTargaFromFile FUN_00489c28: the graphic takes the member's size, and stays empty when
 * MenuRcs lacks it. If the player has moved on while the image was loading, the newer one stays.
 */
async function loadTga(form, box, name) {
  box.wanted = name;
  const image = await form.rt.assets.image(name + '.tga');
  if (box.wanted === name) box.setImage(image);
}

/** TStatusIndicator 0x491520: hidden pips at x + dx * i. show(n) is FUN_00491710. */
class StatusIndicator {
  constructor(form, image, count, x, y, dx) {
    this.pips = [];
    for (let i = 0; i < count; i++) {
      const pip = form.add(new ImageBox(x + dx * i, y, image));
      pip.visible = false;
      this.pips.push(pip);
    }
  }

  show(n) {
    this.pips.forEach((pip, i) => {
      pip.visible = i < n;
    });
    this.pips[0]?.invalidate();
  }
}

/** The `butbigci` row, one pip per Tour track, placed by lblAncTrackInd00 and 01. */
async function trackIndicator(form) {
  const image = await form.rt.assets.image('butbigci.tga');
  const first = form.lblAncTrackInd00;
  const count = form.rt.data.static.tour.trackCount;
  return new StatusIndicator(form, image, count, first.x, first.y, form.lblAncTrackInd01.x - first.x);
}

/** Four rows of nine `klrondje` pips, placed by lblAncInd00, 01 and 10. FUN_0049af5c and FUN_0049c868. */
class CharacterStats {
  static async create(form) {
    const image = await form.rt.assets.image('klrondje.tga');
    const first = form.lblAncInd00;
    const dx = form.lblAncInd01.x - first.x;
    const dy = form.lblAncInd10.y - first.y;
    const row = (r) => new StatusIndicator(form, image, 9, first.x, first.y + dy * r, dx);
    const stats = new CharacterStats();
    stats.speed = row(0);
    stats.accell = row(1);
    stats.handling = row(2);
    stats.brakes = row(3);
    return stats;
  }

  /** FUN_0049ae50. */
  show(char) {
    this.speed.show(char.speed);
    this.accell.show(char.accell);
    this.handling.show(char.handling);
    this.brakes.show(char.brakes);
  }
}

/**
 * The picture cycle of TfrmTrack (FUN_0049a110, timCyclerTimer 0x49a458 with FUN_0049a328) and
 * TfrmQuickRace (FUN_0049cb94, timCyclerTimer 0x49cbec with FUN_0049ca50): six frames, each
 * loaded into the hidden one of two graphics before the two swap.
 */
class Slideshow {
  constructor(form, prefix, currentTrack) {
    this.form = form;
    this.prefix = prefix;
    this.currentTrack = currentTrack;
    this.timer = null;
    this.run = 0;
  }

  /** From the first frame, with a full interval before the second. */
  async restart() {
    const { imgTrack1, imgTrack2 } = this.form;
    this.frame = 5;
    this.loadIntoFirst = true;
    this.run++;
    imgTrack1.visible = false;
    imgTrack2.visible = true;
    this.stop();
    this.start();
    await this.step();
  }

  /** timCycler.Enabled := True. */
  start() {
    this.timer = this.form.setTimer(this.form.timCycler.interval, () => this.step(), true);
  }

  /** timCycler.Enabled := False. */
  stop() {
    this.form.clearTimer(this.timer);
    this.timer = null;
  }

  async step() {
    const { form } = this;
    const { imgTrack1, imgTrack2 } = form;
    const run = this.run;
    this.frame = this.frame === 5 ? 0 : this.frame + 1;
    const hidden = this.loadIntoFirst ? imgTrack1 : imgTrack2;
    this.loadIntoFirst = !this.loadIntoFirst;
    const name = `${this.prefix}${this.currentTrack().indexInGame}_${two(this.frame)}.tga`;
    const image = await form.rt.assets.image(name);
    if (run !== this.run) return;
    hidden.setImage(image);
    imgTrack1.visible = !imgTrack1.visible;
    imgTrack2.visible = !imgTrack2.visible;
    form.invalidate();
  }
}

/** TfrmIntro 0x4a46b8: the movie on a borderless 792x573 form with the black main form behind it. */
export class TfrmIntro extends Form {
  static className = 'TfrmIntro';
  static dfm = 'TFRMINTRO';

  async create() {
    await loadDfm(this, this.constructor.dfm);
    const { ClientWidth, ClientHeight } = this.rt.forms[this.constructor.dfm].props;
    this.width = ClientWidth;
    this.height = ClientHeight;
  }

  // FormShow 0x4a4928. An open or play error closes the form, MenuIntroNotify 0x4a49f4 does at the end.
  onShow() {
    this.keyPreview = (code) => {
      this.userAction(code);
      return true;
    };
    this.onPointer = () => this.userAction(null);
    // The video element lies above the canvas and takes the clicks.
    window.addEventListener('pointerdown', this.onPointer, true);
    this.rt.playVideo('intro1.mp4', this, 0, 0, this.width, this.height, { onMuted: () => this.showSoundNote() }).then(() => this.finishModal());
  }

  /**
   * FormKeyDown 0x4a4a78 ignores VK_SPACE, FormMouseDown 0x4a4ad8 takes any button. Browsers may
   * refuse sound before the first user action. Then the movie plays muted, and the first key or
   * click turns sound on instead of ending it, since one action cannot do both.
   */
  userAction(code) {
    if (this.soundNote) {
      this.soundNote.remove();
      this.soundNote = null;
      const video = this.rt.video?.el;
      if (video) video.muted = false;
      return;
    }
    if (code !== 'Space') this.rt.stopVideo();
  }

  showSoundNote() {
    const note = document.createElement('div');
    note.textContent = 'Klik of druk op een toets voor geluid';
    note.style.cssText = 'position:fixed;left:50%;bottom:max(4px,env(safe-area-inset-bottom));transform:translateX(-50%);padding:2px 8px;background:#000;font-size:14px;white-space:nowrap;pointer-events:none';
    this.rt.overlay.appendChild(note);
    this.soundNote = note;
  }

  onClose() {
    window.removeEventListener('pointerdown', this.onPointer, true);
    this.soundNote?.remove();
    this.rt.stopVideo();
  }
}

const NOTE_INTERNET = 'De website van A2 Racer 4 bestaat niet meer. Daarom kun je hier niet naar het internet.';

/** TfrmMainScreen 0x49d4bc. The player picks Tour or Quick Race and opens options, player, internet. */
export class TfrmMainScreen extends OneWayScreen {
  static className = 'TfrmMainScreen';
  static dfm = 'TFRMMAINSCREEN';

  // FormCreate 0x49db5c and FormShow 0x49d894. btnInternet.Enabled was 0x491024, a browser was found.
  // Port: DOWNLOADURL no longer leads to an A2 Racer site, so TfrmInternetDlg is not reached. The
  // button opens the network races instead, an addition of the port: source/net/, docs/multiplayer.md.
  async create() {
    await super.create();
    this.btnInternet.enabled = Boolean(this.rt.data.app && this.rt.data.app.openMultiplayer);
    this.showTitle();
    const quick = this.rt.data.raceMode === 1;
    (quick ? this.optQuickRace : this.optTour).setChecked(true);
    await loadTga(this, this.imgItem, quick ? 'quick' : 'tour');
  }

  // FUN_0049dc40.
  showTitle() {
    this.lblTitle.setText(this.rt.data.menuFormat(9, this.rt.data.player.name));
  }

  // 0x49dd74
  optTourClick() {
    return loadTga(this, this.imgItem, 'tour');
  }

  // 0x49dd40
  optQuickRaceClick() {
    return loadTga(this, this.imgItem, 'quick');
  }

  // 0x49d888, FUN_0049898c
  btnOptionsClick() {
    return this.rt.showModal(forms.TfrmOptions);
  }

  // 0x49d9fc, FUN_00498634. TfrmPlayer itself does InitDlg and ExitDlg.
  async btnPlayerClick() {
    await this.rt.showModal(forms.TfrmPlayer);
    this.showTitle();
  }

  /** Port: a disabled button takes no clicks, so the form explains it. */
  onBackgroundClick(px, py) {
    if (!this.btnInternet.enabled && this.btnInternet.hit(px, py)) this.rt.data.notApplicable(NOTE_INTERNET);
  }

  /** Port: network races with up to eight players, source/net/. */
  btnInternetClick() {
    return this.rt.data.app.openMultiplayer();
  }

  // 0x49da44. The original also reads static.ini again after a visit to the site, for what a
  // download may have added. Nothing can change that file here.
  next() {
    this.rt.data.raceMode = this.optTour.checked ? 2 : 1;
    return this.rt.goTo(forms.TfrmDifficulty);
  }

  // btnCloseClick 0x49dc20: exits at once, with no dialog.
  closeClick() {
    this.rt.data.raceMode = 0;
    return this.rt.data.doExit();
  }

  portraitZones() {
    return [[392, 0, 408, 400], [0, 20, 392, 478], [25, 545, 355, 50], [640, 515, 160, 80]];
  }
}

/** TfrmDifficulty 0x49cca0. Background `difficul`, or `quickdif` in Quick Race. */
export class TfrmDifficulty extends TwoWayScreen {
  static className = 'TfrmDifficulty';
  static dfm = 'TFRMDIFFICULTY';

  // vmt_0e4 0x49d2b4
  backgroundName() {
    return this.rt.data.raceMode === 1 ? 'quickdif.bmp' : super.backgroundName();
  }

  // FormCreate 0x49d304 and FormShow 0x49cf00
  async create() {
    await super.create();
    const d = this.rt.data;
    await loadTga(this, this.imgItemName, d.raceMode === 2 ? 'headtour' : 'headquic');
    const difficulty = d.player.settings.difficulty;
    const radio = [this.optEasy, this.optMedium, this.optHard][difficulty];
    if (radio) {
      radio.setChecked(true);
      await loadTga(this, this.imgItem, 'diffic' + two(difficulty));
    }
  }

  // 0x49d374
  optEasyClick() {
    return loadTga(this, this.imgItem, 'diffic00');
  }

  // 0x49d3ac
  optMediumClick() {
    return loadTga(this, this.imgItem, 'diffic01');
  }

  // 0x49d3e4
  optHardClick() {
    return loadTga(this, this.imgItem, 'diffic02');
  }

  // 0x49d124
  next() {
    const d = this.rt.data;
    d.player.settings.difficulty = this.optEasy.checked ? 0 : this.optMedium.checked ? 1 : 2;
    if (d.raceMode === 1) this.rt.goTo(forms.TfrmQuickRace);
    else if (d.raceMode === 2) this.rt.goTo(d.player.tourStarted ? forms.TfrmCurrentChar : forms.TfrmCharacter);
  }

  // 0x49d2a0
  previous() {
    return this.rt.goTo(forms.TfrmMainScreen);
  }

  portraitZones() {
    return [[392, 0, 408, 445], [0, 20, 392, 478], [575, 510, 225, 85]];
  }
}

/** TfrmQuickRace 0x49ba10. Any available track and character, then the race. */
export class TfrmQuickRace extends TwoWayScreen {
  static className = 'TfrmQuickRace';
  static dfm = 'TFRMQUICKRACE';

  // FormCreate 0x49bd5c and FormShow 0x49bdec
  async create() {
    await super.create();
    // The DFM has btnNext above imgItem, whose rectangle reaches below Verder's top.
    this.bringToFront(this.btnNext);
    const d = this.rt.data;
    // FUN_0049c78c: once per visit, into a TBooleanList.
    this.trackAvailable = d.static.quickRace.trackIx.map((_, pos) => d.quickTrackAvailable(pos));
    this.slideshow = new Slideshow(this, 'qtc0', () => d.player.qrTrack);
    this.stats = await CharacterStats.create(this);
    await Promise.all([this.setCurrentTrack(d.player.qr.trackIx), this.setCurrentChar(d.player.qr.charIx)]);
    d.raceMode = 1;
    this.updateNext();
  }

  // The event at +0x2e8 runs after the form is visible.
  onShow() {
    super.onShow();
    this.unlock();
  }

  // 0x49c6a0
  async unlock() {
    const d = this.rt.data;
    if (!d.takeUnlock()) return;
    this.setCurrentChar(d.static.quickRace.lockedCharIx);
    this.rt.sound.playVoice('unlock');
    await this.rt.showModal(forms.TfrmUnlock);
  }

  // SetCurrentTrackIndex FUN_0049c198
  async setCurrentTrack(pos) {
    const d = this.rt.data;
    d.selectQuickTrack(pos);
    const track = d.player.qrTrack;
    const record = d.menuIni.highscores[d.player.trackToDrive];
    this.lblTime.setText(d.formatTime(record.time));
    this.lblRecName.setText(record.name);
    this.lblType.setText(track.type);
    this.lblLocked.visible = !this.trackAvailable[pos];
    this.lblLocked.setText(d.menuString(track.isChase ? 7 : 2));
    await Promise.all([loadTga(this, this.imgTrackName, 'trname' + two(d.player.trackToDrive)), this.slideshow.restart()]);
  }

  // SetCurrentCharIx FUN_0049c4d8
  async setCurrentChar(pos) {
    const d = this.rt.data;
    d.player.qr.charIx = pos;
    const char = d.player.qrChar;
    this.lblCharLocked.setText(char.lockedText);
    this.lblCharLocked.visible = !d.quickCharAvailable(pos);
    this.stats.show(char);
    this.updateNext();
    // char+0x10 for both, the static number: not IndexInGame, which differs for the download character.
    await Promise.all([loadTga(this, this.imgCharName, 'chara_' + two(char.index)), loadTga(this, this.imgItem, 'qr_CH' + two(char.index))]);
  }

  // FUN_0049c3c8
  updateNext() {
    const d = this.rt.data;
    this.btnNext.enabled = !!this.trackAvailable[d.player.qr.trackIx] && d.quickCharAvailable(d.player.qr.charIx);
    this.invalidate();
  }

  // 0x49bf7c
  btnPrevTrack1Click() {
    const pos = this.rt.data.player.qr.trackIx;
    this.setCurrentTrack(pos === 0 ? this.rt.data.static.quickRace.trackCount - 1 : pos - 1);
    this.updateNext();
  }

  // 0x49c088
  btnNextTrack1Click() {
    const pos = this.rt.data.player.qr.trackIx;
    this.setCurrentTrack(pos === this.rt.data.static.quickRace.trackCount - 1 ? 0 : pos + 1);
    this.updateNext();
  }

  // 0x49c468
  btnPrevCharClick() {
    const pos = this.rt.data.player.qr.charIx;
    return this.setCurrentChar(pos === 0 ? this.rt.data.static.quickRace.charCount - 1 : pos - 1);
  }

  // 0x49c40c
  btnNextCharClick() {
    const pos = this.rt.data.player.qr.charIx;
    return this.setCurrentChar(pos === this.rt.data.static.quickRace.charCount - 1 ? 0 : pos + 1);
  }

  // 0x49bf18: as on the Garage, but timCycler stops around the dialog.
  async next() {
    this.slideshow.stop();
    if (!(await this.rt.data.flow.startInfoThenRace(this.rt))) this.slideshow.start();
  }

  // 0x49bf04
  previous() {
    return this.rt.goTo(forms.TfrmDifficulty);
  }

  // btnCloseClick 0x49cbf8: after Annuleren the slideshow stays stopped until the next track change.
  closeClick() {
    this.slideshow.stop();
    return super.closeClick();
  }

  portraitZones() {
    return [[392, 0, 408, 285], [0, 25, 392, 265], [0, 312, 392, 240], [392, 290, 408, 305]];
  }
}

/** TfrmCurrentChar 0x49b288. The chosen Tour character and how far it has come. */
export class TfrmCurrentChar extends TwoWayScreen {
  static className = 'TfrmCurrentChar';
  static dfm = 'TFRMCURRENTCHAR';

  // FormCreate 0x49b704 and FormShow 0x49b4fc
  async create() {
    await super.create();
    const player = this.rt.data.player;
    const number = two(player.tourChar.indexInGame);
    this.lblPoints.setText(String(player.euro));
    const indicator = await trackIndicator(this);
    indicator.show(player.result.trackReached);
    await Promise.all([loadTga(this, this.imgItemName, 'chara_' + number), loadTga(this, this.imgItem, 'ch_' + number)]);
  }

  onShow() {
    super.onShow();
    this.rt.sound.playVoice('aud3');
  }

  // 0x49b4e8
  btnChooseCharClick() {
    return this.rt.goTo(forms.TfrmCharacter);
  }

  // 0x49b4d4
  next() {
    return this.rt.goTo(forms.TfrmTrack);
  }

  // 0x49b61c
  previous() {
    return this.rt.goTo(forms.TfrmDifficulty);
  }

  portraitZones() {
    return [[392, 0, 408, 420], [0, 20, 392, 540], [575, 510, 225, 85]];
  }
}

/** TfrmCharacter 0x49a810. Cycles the five Tour characters. */
export class TfrmCharacter extends TwoWayScreen {
  static className = 'TfrmCharacter';
  static dfm = 'TFRMCHARACTER';

  // FormShow 0x49ae00
  async create() {
    await super.create();
    this.imgCar.onClick = () => this.imgCarClick();
    this.trackPips = await trackIndicator(this);
    this.stats = await CharacterStats.create(this);
    await this.setCurrentChar(this.rt.data.player.tour.charIx);
  }

  onShow() {
    super.onShow();
    this.rt.data.player.tourStarted = true;
  }

  // SetCurrentCharIx FUN_0049ac68
  async setCurrentChar(pos) {
    const player = this.rt.data.player;
    player.tour.charIx = pos;
    this.trackPips.show(player.result.trackReached);
    const char = player.tourChar;
    this.stats.show(char);
    this.lblTextBlock.setText(char.story);
    const number = two(char.indexInGame);
    await Promise.all([loadTga(this, this.imgItemName, 'chara_' + number), loadTga(this, this.imgItem, 'ch_' + number)]);
  }

  // 0x49abbc
  btnPrevCharClick() {
    const pos = this.rt.data.player.tour.charIx;
    return this.setCurrentChar(pos === 0 ? this.rt.data.static.tour.charCount - 1 : pos - 1);
  }

  // 0x49ac04
  btnNextCharClick() {
    const pos = this.rt.data.player.tour.charIx;
    return this.setCurrentChar(pos === this.rt.data.static.tour.charCount - 1 ? 0 : pos + 1);
  }

  // 0x49aac4: the character's voice, then timSelection. A second click leaves the running timer alone.
  next() {
    const number = two(this.rt.data.player.tourChar.indexInGame);
    this.rt.sound.playVoice(`CCS${number}_${two(Math.floor(Math.random() * 2))}`);
    if (!this.selection) this.selection = this.setTimer(this.timSelection.interval, () => this.timSelectionTimer());
  }

  // 0x49b18c
  timSelectionTimer() {
    return this.rt.goTo(forms.TfrmTrack);
  }

  // 0x49adec
  previous() {
    return this.rt.goTo(forms.TfrmCurrentChar);
  }

  // OnDblClick 0x49b1b4. The strip's double click, two clicks within the Windows default of 500 ms.
  async imgCarClick() {
    const now = performance.now();
    const double = now - (this.lastCarClick ?? -Infinity) <= 500;
    this.lastCarClick = now;
    if (double && this.rt.data.player.name[0] === 'f') this.imgItem.setImage(await this.rt.assets.image('m018.bmp'));
  }

  portraitZones() {
    return [[392, 0, 408, 420], [0, 20, 392, 540], [575, 510, 225, 85]];
  }
}

/** TfrmTrack 0x49999c. Picks a Tour stage up to the one reached. */
export class TfrmTrack extends TwoWayScreen {
  static className = 'TfrmTrack';
  static dfm = 'TFRMTRACK';

  // FormShow 0x49a168
  async create() {
    await super.create();
    const d = this.rt.data;
    this.slideshow = new Slideshow(this, 'ttc0', () => d.player.tourTrack);
    // FUN_0049a65c with its tail at 0x49a723.
    const indicator = await trackIndicator(this);
    this.imgFocus.y = this.lblAncFocus.y;
    await Promise.all([loadTga(this, this.imgFocus, 'indfocus'), loadTga(this, this.imgItem, 'hunny'), loadTga(this, this.imgShadow, 'shadow')]);
    await this.setCurrentTrack(d.initialTourTrack);
    indicator.show(d.player.result.trackReached);
    this.showTrackInfo();
  }

  // The form was filled before it became visible: tmrSound counts from here.
  onShow() {
    super.onShow();
    this.clearTimer(this.soundTimer);
    this.soundTimer = this.setTimer(this.tmrSound.interval, () => this.tmrSoundTimer());
  }

  // SetCurrentTrackIndex FUN_00499d68. tmrSound only starts if it was off: a second change does not delay it.
  async setCurrentTrack(pos) {
    const d = this.rt.data;
    d.player.tour.trackIx = pos;
    const track = d.player.tourTrack;
    this.imgItem.visible = !track.isChase;
    this.imgShadow.visible = track.isChase;
    const first = this.lblAncTrackInd00;
    this.imgFocus.x = first.x + (this.lblAncTrackInd01.x - first.x) * pos;
    if (!this.soundTimer) this.soundTimer = this.setTimer(this.tmrSound.interval, () => this.tmrSoundTimer());
    await Promise.all([loadTga(this, this.imgTrackName, 'trname' + two(track.indexInGame)), this.slideshow.restart()]);
  }

  // FUN_00499f80
  showTrackInfo() {
    const d = this.rt.data;
    const track = d.player.tourTrack;
    const record = d.menuIni.highscores[track.indexInGame];
    this.lblTime.setText(d.formatTime(record.time));
    this.lblRecName.setText(record.name);
    this.lblQualify.setText(d.qualifyCaption(track));
    this.lblType.setText(track.type);
    this.lblTextBlock.setText(track.story);
    this.btnNextTrack.enabled = d.player.tour.trackIx < d.maxTourTrack;
    this.btnPrevTrack.enabled = d.player.tour.trackIx > 0;
    this.invalidate();
  }

  // 0x49a5c0
  tmrSoundTimer() {
    this.soundTimer = null;
    const track = this.rt.data.player.tourTrack;
    this.rt.sound.playVoice((track.isChase ? 'CTI08_' : 'CTI07_') + two(track.indexInGame));
  }

  // 0x499f28
  btnPrevTrackClick() {
    this.setCurrentTrack(this.rt.data.player.tour.trackIx - 1);
    this.showTrackInfo();
  }

  // 0x499f54
  btnNextTrackClick() {
    this.setCurrentTrack(this.rt.data.player.tour.trackIx + 1);
    this.showTrackInfo();
  }

  // 0x499c7c
  next() {
    const player = this.rt.data.player;
    player.trackToDrive = player.tourTrack.indexInGame;
    return this.rt.goTo(forms.TfrmGarage);
  }

  // 0x499d54
  previous() {
    return this.rt.goTo(forms.TfrmCurrentChar);
  }

  portraitZones() {
    return [[392, 0, 408, 516], [0, 20, 392, 575], [575, 516, 225, 80]];
  }
}

/** TfrmTrackIntro 0x49f7c4. The stage interstitial, no visible buttons. */
export class TfrmTrackIntro extends GameMenuScreen {
  static className = 'TfrmTrackIntro';
  static dfm = 'TFRMTRACKINTRO';

  // FormShow 0x49fa34
  onShow() {
    super.onShow();
    this.rt.sound.playVoice('NextTr');
    this.setTimer(this.timClose.interval, () => this.timCloseTimer());
  }

  // imgBackGroundClick 0x49f958
  onBackgroundClick() {
    return this.rt.goTo(forms.TfrmTrack);
  }

  // 0x49fb28
  timCloseTimer() {
    return this.rt.goTo(forms.TfrmTrack);
  }

  portraitZones() {
    return [[0, 0, 800, 600]];
  }
}
