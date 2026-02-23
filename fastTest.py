import OpenVisus as ov
import numpy as np
import matplotlib.pyplot as plt
import re

DB_URL = "http://atlantis.sci.utah.edu/mod_visus?dataset=nex-gddp-cmip6"
DB = ov.LoadDataset(DB_URL)

def plot_tasmax_pixel_42_ssp(
    x=952, y=488,
    figsize=(14, 8)
):
    """
    Plot 42 tasmax SSP fields (14 models × ssp126/245/370/585) at single pixel.
    CORRECT OpenVisus API: BoxQuery + field + logic_box slice.
    """
    db = DB
    nt = int(db.getTime())
    
    # your exact 42 ssp tasmax fields
    ssp_pattern = re.compile(r'tasmax_day_[^_]+_(ssp1|ssp2|ssp3|ssp5)')
    all_fields = db.getFields()
    ssp_fields = [f for f in all_fields if ssp_pattern.search(f)]
    
    print(f"Plotting {len(ssp_fields)} tasmax SSP fields")
    
    x1, x2 = x, x+1
    y1, y2 = y, y+1
    t1, t2 = 0, nt
    
    fig, ax = plt.subplots(figsize=figsize)
    
    for field_name in ssp_fields:
        try:
            # STEP 1: create empty BoxQuery
            query = db.createBoxQuery()
            
            # STEP 2: set field by index (fields are 0-indexed)
            field_idx = all_fields.index(field_name)
            query.field = field_idx
            
            # STEP 3: set logic box [minX,minY,minZ, maxX,maxY,maxZ]
            query.logic_box = [x1, y1, t1, x2, y2, t2]
            
            # STEP 4: execute query (streams single pixel)
            query.execute()
            
            # STEP 5: get data
            data = query.getSamples().toNumPy()
            ts = np.squeeze(data.astype(np.float32))
            t = np.arange(t1, t1 + len(ts))
            
            # short label
            parts = field_name.split('_')
            short_label = f"{parts[2]}_{parts[3]}"
            ax.plot(t, ts, label=short_label, linewidth=0.8, alpha=0.7)
            
        except Exception as e:
            print(f"Failed {field_name}: {e}")
    
    ax.set_xlabel("time index (days)")
    ax.set_ylabel("tasmax (°C)")
    ax.set_title(f"tasmax at [{x},{y}] - 42 SSP projections")
    ax.legend(fontsize=7, ncol=5)
    ax.grid(True, alpha=0.3)
    plt.tight_layout()
    return fig, ax

fig, ax = plot_tasmax_pixel_42_ssp(x=952, y=488)
plt.show()