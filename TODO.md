# TODO

## Stabilize V2

- verify the dual-panel web flow and radar readability
- tune radar revisit rate, beam width, and noise
- tune classification confidence so distance effects are intuitive
- add lightweight regression checks where practical
- expose the new Python V2 core more explicitly in the desktop path
- align any remaining desktop/web wording with V2 terminology

## Post-V2 Candidates

- formal telemetry export for truth, detections, and tracks
- second-order or maneuvering debris dynamics
- explicit coordinate-frame documentation in code and docs
- camera-style synthetic observation panel
- richer track management and association logic
- comparison metrics between truth and track estimates

## Explicitly Out Of V2

- CNN training
- ego Kalman filter
- orbital mechanics model
- multi-sensor fusion
- full HIL/PIL style integration
