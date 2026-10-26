# CMU recorded walking reference

Original files: https://mocap.cs.cmu.edu/subjects/07/07.asf and
https://mocap.cs.cmu.edu/subjects/07/07_01.amc (subject 07, trial 01, walk, 120 Hz).
Downloaded from the official CMU Graphics Lab Motion Capture Database.

The data used in this project was obtained from mocap.cs.cmu.edu.
The database was created with funding from NSF EIA-0196217.

Use terms: https://mocap.cs.cmu.edu/ . The site permits research use and inclusion
in commercial products, but prohibits direct resale of the data, including in
converted form. These files and their derived reference are not CC0.
No subject identity is inferred. CMU notes that finger and thumb channels were
not captured; those channels are excluded from this conversion.

Rebuild: `python3 scripts/prepare-walk-reference.py` (numpy, scipy).
The generated `src/human/motion/cmu-walk.json` records source hashes, frame range,
ASF forward kinematics, joint convention conversion, periodic filtering and
phase resampling. Runtime motion is slowed and reduced in amplitude to fit this
simplified physical model. Contact/IK/balance corrections change the resulting
motion; this is not exact reproduction of the recorded subject's gait.
