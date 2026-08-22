Generate a sprite sheet for a dashboard pet. Save the final PNG as `out2/chibi-idle.png` inside the current working directory.

STYLE: same flat-illustration sticker look as the attached references (bold dark outlines, flat colours, minimal shading) BUT with compact "desktop pet" proportions: about 2.5 head units — large head with the same tall golden jamang, big expressive single eye, small compact body, short legs, the long curling tail kept large because it is the main expressive part. Still a dignified wayang Anoman, not a generic cartoon monkey: keep the profile, the crown, the sarong, the white body.

SUBJECT: the attached character — "Anoman" (Hanoman) in Javanese wayang style: white-furred monkey hero in RIGHT-FACING PROFILE (one visible eye), lifted head, tall golden jamang/crown ornament, curly white hair at the back of the head, gold necklace/armbands, red-and-gold kain (sarong), barefoot, and a LONG curling tail with a golden ornament at the tip. Keep this character, costume and colours. Never mirror him; he always faces right.

LAYOUT: landscape canvas 1536x1024. A 4-column x 2-row grid of 8 equal cells (384 x 512 px each). ONE full-body pose per cell, reading left-to-right then top-to-bottom = frames 1..8 of a looping animation. Draw the character about 80% of the cell height, horizontally centred in its cell, feet on the same baseline in every cell. Leave clear empty space between cells; never let a tail or ornament cross into the neighbouring cell. No grid lines, borders, numbers, labels, text, shadows, ground or props.

REGISTRATION (critical): treat the character as a puppet on a fixed pin. In ALL 8 frames the feet, legs, sarong hem and the lower torso are drawn at EXACTLY the same position and size — trace them identically. Only these parts move: chest/shoulders (breathing), head (small lift/tilt), the visible eye (blink), the raised hand, and the tail. Nothing else changes between frames.

ANIMATION "idle" (8 frames, loops) — make the motion clearly readable even when the sprite is 96 px tall: 
frame 1 rest pose; 
frame 2 inhale: chest rises, head lifts ~4% and tilts up slightly, tail tip starts rising; 
frame 3 peak: head at its highest, raised hand lifts a little, tail tip at its highest (clearly higher than frame 1); 
frame 4 blink at the peak: visible eye fully CLOSED, everything else as frame 3; 
frame 5 eye open, head starts lowering, tail tip swings back down; 
frame 6 mid settle; 
frame 7 slight overshoot: head a touch LOWER than rest, tail tip at its lowest; 
frame 8 back to rest pose (equal to frame 1).

BACKGROUND: flat pure magenta #FF00FF, no halo, no anti-aliased fringe (it will be chroma-keyed). Use your image generation tool, then run the chroma-key removal you have available so the saved PNG has a transparent background. Produce exactly ONE final image. Do not write code files. Your final message: the absolute path of the saved file and its pixel size.
