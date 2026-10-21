import geopandas as gpd
import matplotlib.pyplot as plt

# Load a shapefile of US counties from the Census Bureau
url = 'https://www2.census.gov/geo/tiger/GENZ2021/shp/cb_2021_us_county_500k.zip'
gdf = gpd.read_file(url)

# List of counties to highlight (Maricopa, AZ; San Bernardino, CA; Pickens, SC)
highlighted_counties_red = [
    ('Maricopa', '04'),  # Arizona FIPS: '04'
    ('San Bernardino', '06')  # California FIPS: '06'
]

highlighted_counties_blue = [
    ('Pickens', '45')  # South Carolina FIPS: '45'
]

# Mark the counties: red for Maricopa and San Bernardino, blue for Pickens
def set_color(row):
    if (row['NAME'], row['STATEFP']) in highlighted_counties_red:
        return 'red'
    elif (row['NAME'], row['STATEFP']) in highlighted_counties_blue:
        return 'blue'
    else:
        return 'lightgray'

gdf['color'] = gdf.apply(set_color, axis=1)

# Plot the US counties with the selected counties in red and blue
fig, ax = plt.subplots(1, 1, figsize=(15, 10))
gdf.plot(ax=ax, color=gdf['color'], edgecolor='black')

# Add a title and show the plot
plt.title("US Counties - Maricopa (AZ) & San Bernardino (CA) in Red, Pickens (SC) in Blue", fontsize=15)
plt.axis('off')  # Hide the axes
plt.show()
