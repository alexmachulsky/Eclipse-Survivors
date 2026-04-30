import { useCallback, useRef, useState } from 'react';
import { GameCanvas } from './components/GameCanvas';
import { Hud } from './components/Hud';
import { EndScreen, MainMenu, PauseMenu } from './components/OverlayScreens';
import { UpgradeScreen } from './components/UpgradeScreen';
import { GameEngine, type GameSnapshot } from './game/GameEngine';

const initialSnapshot: GameSnapshot = new GameEngine().getSnapshot();

export default function App() {
  const engineRef = useRef<GameEngine | null>(null);
  const [snapshot, setSnapshot] = useState<GameSnapshot>(initialSnapshot);

  const handleReady = useCallback((engine: GameEngine) => {
    engineRef.current = engine;
    setSnapshot(engine.getSnapshot());
  }, []);

  const refreshSnapshot = useCallback(() => {
    const engine = engineRef.current;

    if (engine) {
      setSnapshot(engine.getSnapshot());
    }
  }, []);

  const startRun = () => {
    engineRef.current?.startRun();
    refreshSnapshot();
  };

  const resumeRun = () => {
    engineRef.current?.resume();
    refreshSnapshot();
  };

  const pauseRun = () => {
    engineRef.current?.pause();
    refreshSnapshot();
  };

  const chooseUpgrade = (upgradeId: string) => {
    engineRef.current?.selectUpgrade(upgradeId);
    refreshSnapshot();
  };

  return (
    <main className="app-shell">
      <GameCanvas onReady={handleReady} onSnapshot={setSnapshot} />
      {snapshot.phase !== 'menu' && <Hud snapshot={snapshot} onPause={pauseRun} />}
      {snapshot.phase === 'menu' && <MainMenu onStart={startRun} />}
      {snapshot.phase === 'paused' && <PauseMenu weapons={snapshot.weapons} onResume={resumeRun} onRestart={startRun} />}
      {snapshot.phase === 'levelUp' && <UpgradeScreen title="Choose a boon" label="Level Up" choices={snapshot.upgradeChoices} onChoose={chooseUpgrade} />}
      {snapshot.phase === 'chestReward' && <UpgradeScreen title="Open the chest" label="Chest Reward" choices={snapshot.pendingChestChoices} onChoose={chooseUpgrade} />}
      {snapshot.phase === 'gameOver' && <EndScreen snapshot={snapshot} onRestart={startRun} />}
      {snapshot.phase === 'victory' && <EndScreen snapshot={snapshot} onRestart={startRun} victory />}
    </main>
  );
}
